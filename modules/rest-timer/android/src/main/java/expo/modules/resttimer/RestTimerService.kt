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
 * Runs while resting between sets. It shows an ongoing notification whose countdown is drawn by
 * the system (so it keeps ticking on the lock screen with the app closed, and becomes a Live Update
 * on Android 16) and, while the app is in the background, a draggable bubble over other apps.
 * The rest-end sound is a separate alarm scheduled with expo-notifications.
 */
class RestTimerService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val finish = Runnable { stopSelf() }
  private var endsAt = 0L
  private var title = ""
  private var body = ""
  private var overlayEnabled = false
  private var overlay: View? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    endsAt = intent?.getLongExtra(EXTRA_ENDS_AT, 0L) ?: 0L
    title = intent?.getStringExtra(EXTRA_TITLE) ?: "Descanso"
    body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    overlayEnabled = intent?.getBooleanExtra(EXTRA_OVERLAY, false) ?: false
    val remaining = endsAt - System.currentTimeMillis()

    // startForeground must always be called after startForegroundService, even when stopping.
    ensureChannel()
    val notification = buildNotification(remaining.coerceAtLeast(0))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (remaining <= 0) {
      stopSelf()
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
    if (instance === this) instance = null
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Cuenta atrás del descanso",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Tiempo de descanso restante, también en la pantalla de bloqueo"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(remaining: Long): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_ID).setTimeoutAfter(remaining + 2000)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    builder
      .setSmallIcon(R.drawable.ic_rest_timer)
      .setContentTitle(title)
      .setContentText(body)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setWhen(endsAt)
      .setShowWhen(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setColor(ACCENT)
    openAppIntent()?.let { builder.setContentIntent(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
      // Live Updates arrived in a later Android 16 minor release; the first 36 builds lack the method.
      runCatching { builder.setRequestPromotedOngoing(true) }
    }
    return builder.build()
  }

  private fun launchIntent(): Intent? =
    packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    }

  private fun openAppIntent(): PendingIntent? =
    launchIntent()?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

  private fun updateOverlay() {
    val shouldShow = overlayEnabled && !appInForeground && canDrawOverlays(this)
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
        setStroke(dp(2f).toInt(), ACCENT)
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

  companion object {
    private const val CHANNEL_ID = "rest-countdown-v1"
    private const val NOTIFICATION_ID = 7341
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

    @Volatile
    private var appInForeground = true
    @Volatile
    private var instance: RestTimerService? = null

    fun start(context: Context, endsAt: Long, title: String, body: String, overlay: Boolean) {
      val intent = Intent(context, RestTimerService::class.java)
        .putExtra(EXTRA_ENDS_AT, endsAt)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
        .putExtra(EXTRA_OVERLAY, overlay)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, RestTimerService::class.java))
    }

    fun setAppInForeground(foreground: Boolean) {
      appInForeground = foreground
      instance?.let { service -> service.handler.post { service.updateOverlay() } }
    }

    fun canDrawOverlays(context: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
  }
}
