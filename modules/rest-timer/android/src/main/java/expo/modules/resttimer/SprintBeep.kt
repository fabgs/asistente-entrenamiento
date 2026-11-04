package expo.modules.resttimer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * The start beep of the sprints, played by the app itself (PLAN.md §6.8). Through a notification
 * it sounded 0,4–0,8 s late and irregular: Android holds each new notification ~200 ms and SystemUI
 * then prepares a player.
 *
 * A thread at audio priority, holding a wake lock, waits for the start in the process (alive thanks
 * to the countdown service), opens the output with silence just before and plays a tone already
 * loaded in memory, on the alarm stream (it sounds in silent mode). It measures when the sound
 * really came out and learns the output latency of the phone for the next beeps.
 *
 * An alarm-clock alarm [LEAD_MS] before is the backup if the process dies: it starts the app again
 * and [SprintBeepReceiver] rings. It cannot be the main way: Android delivers an alarm no sooner
 * than 5 s after it is set, and after «Saltar descanso» the start is just 5 s away.
 */
object SprintBeep {
  private const val TAG = "Entreno"
  private const val ACTION = "expo.modules.resttimer.SPRINT_BEEP"
  private const val EXTRA_GO_AT = "goAt"
  private const val LEAD_MS = 2_000L
  /** Closer than this, the thread waits for the start itself; further, only the alarm does. */
  private const val WAIT_IN_PROCESS_MS = 60_000L
  private const val WARM_UP_BEFORE_MS = 800L
  private const val TONE_HZ = 2_000.0
  private const val TONE_MS = 250
  private const val PREFS = "sprint-beep"
  private const val LATENCY_KEY = "latencyMs"
  private const val DEFAULT_LATENCY_MS = 40L

  /** In a process started by the alarm itself, before the app has scheduled or cancelled anything. */
  private const val UNKNOWN = Long.MIN_VALUE

  /** The start that should sound; -1 after cancelling. A thread whose start is no longer this one stays quiet. */
  private val armed = AtomicLong(UNKNOWN)
  /** Starts a thread is already waiting for, so asking again for one does not start another thread. */
  private val ringing = ConcurrentHashMap.newKeySet<Long>()
  /** The last start that sounded: never twice. */
  private val played = AtomicLong(-1)

  fun schedule(context: Context, goAt: Long) {
    if (armed.get() == goAt && (goAt in ringing || played.get() == goAt)) return
    armed.set(goAt)
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val wakeAt = goAt - LEAD_MS
    val now = System.currentTimeMillis()
    if (goAt - now <= WAIT_IN_PROCESS_MS) ring(context, goAt) {}
    if (wakeAt <= now) {
      alarms.cancel(alarmIntent(context, goAt))
      return
    }
    try {
      alarms.setAlarmClock(AlarmManager.AlarmClockInfo(wakeAt, showIntent(context)), alarmIntent(context, goAt))
    } catch (e: SecurityException) {
      Log.w(TAG, "[sprint] sin alarma exacta; el pitido depende de que la app siga viva", e)
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, wakeAt, alarmIntent(context, goAt))
    }
  }

  fun cancel(context: Context) {
    armed.set(-1)
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarms.cancel(alarmIntent(context, 0))
  }

  /**
   * From the alarm. In a process started just for it nothing has armed the beep yet, so this does;
   * one the app cancelled stays cancelled even if its alarm was already on its way.
   */
  internal fun onAlarm(context: Context, goAt: Long, done: () -> Unit) {
    armed.compareAndSet(UNKNOWN, goAt)
    if (armed.get() == goAt) ring(context, goAt, done) else done()
  }

  private fun ring(context: Context, goAt: Long, done: () -> Unit) {
    if (played.get() == goAt || !ringing.add(goAt)) return done()
    val app = context.applicationContext
    thread(name = "sprint-beep", priority = Thread.MAX_PRIORITY) {
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      val power = app.getSystemService(Context.POWER_SERVICE) as PowerManager
      val wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "entreno:sprint-beep")
      wake.acquire((goAt - System.currentTimeMillis()).coerceAtLeast(0) + 3_000)
      try {
        play(app, goAt)
      } catch (e: Exception) {
        Log.e(TAG, "[sprint] no se pudo tocar el pitido", e)
      } finally {
        ringing.remove(goAt)
        if (wake.isHeld) wake.release()
        done()
      }
    }
  }

  private fun play(context: Context, goAt: Long) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val latency = prefs.getLong(LATENCY_KEY, DEFAULT_LATENCY_MS)
    val rate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_ALARM).takeIf { it > 0 } ?: 48_000
    val tone = staticTrack(rate, tonePcm(rate))
    val silence = staticTrack(rate, ShortArray(rate / 10))
    try {
      // The output goes to standby after a few seconds without sound; opening it just before keeps
      // the first samples of the beep from waiting for it.
      if (!waitUntil(goAt, goAt - WARM_UP_BEFORE_MS)) return
      silence.play()
      if (!waitUntil(goAt, goAt - latency)) return
      if (armed.get() != goAt || played.getAndSet(goAt) == goAt) return
      val playedAt = System.currentTimeMillis()
      tone.play()
      vibrate(context)
      val heardAt = presentedAt(tone, rate)
      if (heardAt != null) {
        val measured = (heardAt - playedAt).coerceIn(0, 400)
        prefs.edit().putLong(LATENCY_KEY, (latency + measured) / 2).apply()
        Log.i(TAG, "[sprint] pitido ${heardAt - goAt} ms (play ${playedAt - goAt} ms, latencia $measured ms)")
      } else {
        Log.i(TAG, "[sprint] pitido sin marca de tiempo (play ${playedAt - goAt} ms)")
      }
      Thread.sleep(TONE_MS + 100L)
    } finally {
      tone.release()
      silence.release()
    }
  }

  /** Sleeps until `at` (wall clock); false if the beep was cancelled or moved meanwhile. */
  private fun waitUntil(goAt: Long, at: Long): Boolean {
    while (true) {
      if (armed.get() != goAt) return false
      val left = at - System.currentTimeMillis()
      if (left <= 0) return true
      Thread.sleep(min(left, 20))
    }
  }

  /** When the first sample reached the speaker (wall clock), from the track's own timestamp. */
  private fun presentedAt(track: AudioTrack, rate: Int): Long? {
    val stamp = AudioTimestamp()
    repeat(50) {
      if (track.getTimestamp(stamp) && stamp.framePosition > 0) {
        val firstNanos = stamp.nanoTime - stamp.framePosition * 1_000_000_000L / rate
        return System.currentTimeMillis() - (System.nanoTime() - firstNanos) / 1_000_000
      }
      Thread.sleep(10)
    }
    return null
  }

  private fun tonePcm(rate: Int): ShortArray {
    val count = rate * TONE_MS / 1000
    val ramp = rate * 0.005
    return ShortArray(count) { i ->
      val fade = min(1.0, min(i, count - 1 - i) / ramp)
      (sin(2 * PI * TONE_HZ * i / rate) * fade * 0.8 * Short.MAX_VALUE).toInt().toShort()
    }
  }

  private fun staticTrack(rate: Int, pcm: ShortArray): AudioTrack =
    try {
      buildTrack(rate, pcm, lowLatency = true)
    } catch (e: Exception) {
      // Some phones refuse the low-latency path for a static track.
      buildTrack(rate, pcm, lowLatency = false)
    }

  private fun buildTrack(rate: Int, pcm: ShortArray, lowLatency: Boolean): AudioTrack {
    val builder = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(rate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()
      )
      .setTransferMode(AudioTrack.MODE_STATIC)
      .setBufferSizeInBytes(pcm.size * 2)
    if (lowLatency && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
    }
    return builder.build().also { it.write(pcm, 0, pcm.size) }
  }

  private fun vibrate(context: Context) {
    @Suppress("DEPRECATION")
    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      @Suppress("DEPRECATION")
      vibrator.vibrate(VibrationEffect.createOneShot(250, VibrationEffect.DEFAULT_AMPLITUDE), attributes)
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(250, attributes)
    }
  }

  /** Always the same request code: there is only one beep pending, and cancel finds it. */
  private fun alarmIntent(context: Context, goAt: Long): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      7342,
      // Foreground broadcast queue: the background one can hold an alarm's broadcast for seconds.
      Intent(context, SprintBeepReceiver::class.java)
        .setAction(ACTION)
        .putExtra(EXTRA_GO_AT, goAt)
        .addFlags(Intent.FLAG_RECEIVER_FOREGROUND),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  private fun showIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, 7343, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  internal fun goAtOf(intent: Intent): Long = intent.getLongExtra(EXTRA_GO_AT, -1)
}

class SprintBeepReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val goAt = SprintBeep.goAtOf(intent)
    if (goAt <= 0) return
    // Keeps the process alive until the beep has sounded (a few seconds), even if the alarm started it.
    val pending = goAsync()
    SprintBeep.onAlarm(context, goAt) { pending.finish() }
  }
}
