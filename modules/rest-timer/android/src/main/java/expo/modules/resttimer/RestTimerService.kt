package expo.modules.resttimer

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Chronometer
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/**
 * Runs while resting between sets and, if one is set, for the whole activity (a workout). While
 * resting it shows an ongoing notification whose countdown is drawn by the system (so it keeps
 * ticking on the lock screen with the app closed, and becomes a Live Update on Android 16) and,
 * while the app is in the background, a draggable bubble over other apps. Otherwise it shows the
 * activity in progress with a chronometer counting up, as a way back into the app; a countdown
 * that ends falls back to it. While a sprint runs (1.5.0) it shows that instead, counting up from
 * its start, with a «Parar» that stops it: set before the start, it takes over when the countdown to
 * the beep ends. The rest-end sound is a separate alarm scheduled with expo-notifications.
 */
class RestTimerService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val finish = Runnable { endCountdown() }
  private var endsAt = 0L
  private var title = ""
  private var body = ""
  private var overlayEnabled = false
  private var overlay: View? = null
  private var foreground = false

  private fun counting() = endsAt > System.currentTimeMillis()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannels()
    if (intent?.action != ACTION_COUNTDOWN) {
      // The activity in progress, unless a countdown is running (it comes back when that ends).
      if (counting()) post(buildCountdown(endsAt - System.currentTimeMillis())) else showOngoingOrStop()
      return START_NOT_STICKY
    }
    endsAt = intent.getLongExtra(EXTRA_ENDS_AT, 0L)
    title = intent.getStringExtra(EXTRA_TITLE) ?: "Descanso"
    body = intent.getStringExtra(EXTRA_BODY) ?: ""
    overlayEnabled = intent.getBooleanExtra(EXTRA_OVERLAY, false)
    val remaining = endsAt - System.currentTimeMillis()

    // startForeground must always be called after startForegroundService, even when stopping.
    post(buildCountdown(remaining.coerceAtLeast(0)))
    if (remaining <= 0) {
      endCountdown()
      return START_NOT_STICKY
    }

    handler.removeCallbacks(finish)
    handler.postDelayed(finish, remaining)
    removeOverlay()
    updateOverlay()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(finish)
    removeOverlay()
    stopForeground(STOP_FOREGROUND_REMOVE)
    foreground = false
    if (instance === this) instance = null
    super.onDestroy()
  }

  /** Shows `notification` as the service's only one (the first time, as a foreground service). */
  private fun post(notification: Notification) {
    if (foreground) {
      getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
      return
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    foreground = true
  }

  /** The countdown is over or was cancelled: back to the activity in progress, if there is one. */
  internal fun endCountdown() {
    handler.removeCallbacks(finish)
    endsAt = 0L
    removeOverlay()
    showOngoingOrStop()
  }

  internal fun refreshOngoing() {
    if (!counting()) showOngoingOrStop()
  }

  private fun showOngoingOrStop() {
    val sprint = running
    // The countdown to the beep ends a moment before or after the start it counts to.
    if (sprint != null && sprint.startedAt <= System.currentTimeMillis() + 50) {
      post(buildRunning(sprint))
      return
    }
    val activity = ongoing
    if (activity == null) {
      // Started for an activity cleared on the way: foreground first, as Android requires.
      if (!foreground) post(buildOngoing(Ongoing(System.currentTimeMillis(), "", "")))
      stopSelf()
      return
    }
    post(buildOngoing(activity))
  }

  private fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    fun create(id: String, name: String, text: String) {
      if (manager.getNotificationChannel(id) != null) return
      val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = text
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
    }
    create(CHANNEL_ID, "Cuenta atrás del descanso", "Tiempo de descanso restante, también en la pantalla de bloqueo")
    create(ONGOING_CHANNEL_ID, "Entreno en curso", "Para volver al entreno con un toque mientras está en marcha")
  }

  private fun buildCountdown(remaining: Long): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_ID).setTimeoutAfter(remaining + 2000)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    builder.setContentTitle(title).setContentText(body).setChronometerCountDown(true).setWhen(endsAt)
    return decorate(builder)
  }

  /** The activity in progress, with the time since it started counting up. */
  private fun buildOngoing(activity: Ongoing): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, ONGOING_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    builder
      .setContentTitle(activity.title)
      .setContentText(activity.body)
      .setChronometerCountDown(false)
      .setWhen(activity.startedAt)
    return decorate(builder)
  }

  /** A sprint running, with the time since its start counting up and «Parar». */
  private fun buildRunning(sprint: Ongoing): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, ONGOING_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    builder
      .setContentTitle(sprint.title)
      .setContentText(sprint.body)
      .setChronometerCountDown(false)
      .setWhen(sprint.startedAt)
    val stop = PendingIntent.getBroadcast(
      this,
      STOP_REQUEST,
      Intent(this, SprintStopReceiver::class.java).addFlags(Intent.FLAG_RECEIVER_FOREGROUND),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    @Suppress("DEPRECATION")
    builder.addAction(Notification.Action.Builder(smallIcon(), "Parar", stop).build())
    return decorate(builder)
  }

  private fun decorate(builder: Notification.Builder): Notification {
    builder
      .setSmallIcon(smallIcon())
      .setUsesChronometer(true)
      .setShowWhen(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      // An explicit group keeps Android from bundling the countdown with the app's other
      // notifications, where it would sit collapsed and out of sight on the lock screen.
      .setGroup(GROUP_KEY)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setColor(ACCENT)
    openAppIntent()?.let { builder.setContentIntent(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Otherwise Android 12+ may hold a foreground service notification back for up to 10 s.
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    // Live Updates arrived in a later Android 16 minor release; the first 36 builds lack the method.
    val promoted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA &&
      runCatching { builder.setRequestPromotedOngoing(true) }.isSuccess
    if (!promoted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Colorized foreground service notifications get their own section at the top of the shade
      // and lock screen (Android 12+), above conversations. Live Updates must not be colorized.
      builder.setColorized(true).setColor(CARD)
    }
    return builder.build()
  }

  private fun launchIntent(): Intent? =
    packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    }

  /** The app's notification icon (generated by the expo-notifications plugin), like its other notifications. */
  @SuppressLint("DiscouragedApi")
  private fun smallIcon(): Int =
    resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 }
      ?: R.drawable.ic_rest_timer

  private fun openAppIntent(): PendingIntent? =
    launchIntent()?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

  internal fun updateOverlay() {
    val shouldShow = overlayEnabled && counting() && !appInForeground && canDrawOverlays(this)
    if (shouldShow && overlay == null) {
      showOverlay()
    } else if (!shouldShow) {
      removeOverlay()
    }
  }

  private fun dp(value: Float) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)

  @SuppressLint("ClickableViewAccessibility")
  private fun showOverlay() {
    val windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    val label = TextView(this).apply {
      text = "Descanso"
      setTextColor(MUTED)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      gravity = Gravity.CENTER
    }
    val countdown = Chronometer(this).apply {
      base = SystemClock.elapsedRealtime() + (endsAt - System.currentTimeMillis())
      isCountDown = true
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      start()
    }
    val bubble = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      val h = dp(18f).toInt()
      val v = dp(8f).toInt()
      setPadding(h, v, h, v)
      background = GradientDrawable().apply {
        cornerRadius = dp(28f)
        setColor(BACKGROUND)
      }
      elevation = dp(6f)
      addView(label)
      addView(countdown)
    }

    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      }
    val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = prefs.getInt(PREF_X, (resources.displayMetrics.widthPixels - dp(140f)).toInt())
      y = prefs.getInt(PREF_Y, (resources.displayMetrics.heightPixels * 0.2f).toInt())
    }

    val touchSlop = ViewConfiguration.get(this).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var startX = 0
    var startY = 0
    var dragging = false
    bubble.setOnTouchListener { view, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          startX = params.x
          startY = params.y
          dragging = false
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (dragging || abs(dx) > touchSlop || abs(dy) > touchSlop) {
            dragging = true
            params.x = startX + dx.toInt()
            params.y = startY + dy.toInt()
            windowManager.updateViewLayout(view, params)
          }
        }
        MotionEvent.ACTION_UP -> {
          if (dragging) {
            prefs.edit().putInt(PREF_X, params.x).putInt(PREF_Y, params.y).apply()
          } else {
            launchIntent()?.let { startActivity(it) }
          }
        }
      }
      true
    }

    windowManager.addView(bubble, params)
    overlay = bubble
  }

  private fun removeOverlay() {
    val view = overlay ?: return
    overlay = null
    runCatching { (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view) }
  }

  private data class Ongoing(val startedAt: Long, val title: String, val body: String)

  companion object {
    private const val CHANNEL_ID = "rest-countdown-v1"
    private const val ONGOING_CHANNEL_ID = "activity-ongoing-v1"
    private const val ACTION_COUNTDOWN = "expo.modules.resttimer.COUNTDOWN"
    private const val ACTION_ONGOING = "expo.modules.resttimer.ONGOING"
    private const val GROUP_KEY = "rest-countdown"
    private const val NOTIFICATION_ID = 7341
    private const val STOP_REQUEST = 7344
    private const val EXTRA_ENDS_AT = "endsAt"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_OVERLAY = "overlay"
    private const val PREFS = "rest_timer_overlay"
    private const val PREF_X = "x"
    private const val PREF_Y = "y"
    private const val ACCENT = 0xFF4ADE80.toInt()
    private const val MUTED = 0xFF9AA4B2.toInt()
    private const val BACKGROUND = 0xEE171B22.toInt()
    private const val CARD = 0xFF171B22.toInt()

    @Volatile
    private var appInForeground = true
    @Volatile
    private var instance: RestTimerService? = null
    /** Shown whenever no countdown is running; it outlives the countdowns. */
    @Volatile
    private var ongoing: Ongoing? = null
    /** A sprint running, or about to when its countdown ends: shown instead of `ongoing`. */
    @Volatile
    private var running: Ongoing? = null

    private fun launch(context: Context, intent: Intent) {
      // Android 12+ refuses to start a foreground service from the background. The app calls this
      // from its screens, so a refusal only delays the notification to the next call.
      runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      }
    }

    fun start(context: Context, endsAt: Long, title: String, body: String, overlay: Boolean) {
      val intent = Intent(context, RestTimerService::class.java)
        .setAction(ACTION_COUNTDOWN)
        .putExtra(EXTRA_ENDS_AT, endsAt)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
        .putExtra(EXTRA_OVERLAY, overlay)
      launch(context, intent)
    }

    /** Ends the countdown: the activity in progress shows again, or the service stops. */
    fun stop(context: Context) {
      val service = instance
      if (service != null) {
        service.handler.post { service.endCountdown() }
      } else if (ongoing != null) {
        launch(context, Intent(context, RestTimerService::class.java).setAction(ACTION_ONGOING))
      }
    }

    fun startOngoing(context: Context, startedAt: Long, title: String, body: String) {
      ongoing = Ongoing(startedAt, title, body)
      val service = instance
      if (service != null) {
        service.handler.post { service.refreshOngoing() }
      } else {
        launch(context, Intent(context, RestTimerService::class.java).setAction(ACTION_ONGOING))
      }
    }

    fun stopOngoing() {
      ongoing = null
      val service = instance ?: return
      service.handler.post { service.refreshOngoing() }
    }

    /**
     * The sprint that starts at `startAt` (now or when the countdown to its beep ends): its
     * notification with «Parar», and the volume buttons stop it from `minMs` after the start.
     */
    fun startSprintRunning(context: Context, startAt: Long, title: String, body: String, minMs: Long) {
      running = Ongoing(startAt, title, body)
      SprintStop.arm(startAt, minMs)
      val service = instance
      if (service != null) {
        service.handler.post { service.refreshOngoing() }
      } else if (startAt <= System.currentTimeMillis()) {
        launch(context, Intent(context, RestTimerService::class.java).setAction(ACTION_ONGOING))
      }
    }

    fun stopSprintRunning() {
      running = null
      SprintStop.disarm()
      val service = instance ?: return
      service.handler.post { service.refreshOngoing() }
    }

    fun setAppInForeground(foreground: Boolean) {
      appInForeground = foreground
      instance?.let { service -> service.handler.post { service.updateOverlay() } }
    }

    fun canDrawOverlays(context: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
  }
}
