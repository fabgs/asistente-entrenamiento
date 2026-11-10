package expo.modules.resttimer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log

/**
 * Stopping a sprint without the screen's «Parar» (PLAN.md §6.8, 1.5.0): with a volume button while
 * the app is in front, or with the «Parar» of the notification shown while running. The moment that
 * counts is the press, taken here, not when the JavaScript gets to it: it is kept (also across a
 * restart of the JavaScript) until the app takes it, and the app applies it as a tap at that time.
 */
object SprintStop {
  private const val TAG = "Entreno"
  private const val PREFS = "sprint-stop"
  private const val KEY_AT = "at"
  private const val KEY_SOURCE = "source"
  private const val VIBRATION_MS = 300L

  /** The start of the sprint running (or about to), or -1: buttons do nothing. */
  @Volatile
  private var startAt = -1L
  /** A press sooner than this after the start is a squeeze of the phone, not a stop. */
  @Volatile
  private var minMs = 3_000L
  /** The start a stop was already taken for: one stop per sprint. */
  @Volatile
  private var stoppedFor = -1L

  /** Set by the module while the JavaScript is alive: a stop is announced at once. */
  @Volatile
  internal var listener: ((Long, String) -> Unit)? = null

  fun arm(start: Long, min: Long) {
    startAt = start
    minMs = min
  }

  fun disarm() {
    startAt = -1L
  }

  /** Whether the volume buttons belong to the sprint now (it is running). */
  fun capturing(now: Long = System.currentTimeMillis()): Boolean = startAt in 1..now

  /**
   * A press at `at` (epoch ms). Ignored before the sprint has run `minMs` and after its first stop;
   * otherwise kept, felt in the hand and announced.
   */
  fun record(context: Context, at: Long, source: String) {
    val start = startAt
    if (start <= 0 || at < start + minMs || stoppedFor == start) return
    stoppedFor = start
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putLong(KEY_AT, at)
      .putString(KEY_SOURCE, source)
      .apply()
    Log.i(TAG, "[sprint] parado con $source a los ${at - start} ms")
    vibrate(context)
    listener?.invoke(at, source)
  }

  /** The stop kept, if any, and forgets it: each one is applied once. */
  fun take(context: Context): Pair<Long, String>? {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val at = prefs.getLong(KEY_AT, -1L)
    if (at <= 0) return null
    val source = prefs.getString(KEY_SOURCE, "volume") ?: "volume"
    prefs.edit().remove(KEY_AT).remove(KEY_SOURCE).apply()
    return at to source
  }

  private fun vibrate(context: Context) {
    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createOneShot(VIBRATION_MS, VibrationEffect.DEFAULT_AMPLITUDE), attributes)
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(VIBRATION_MS, attributes)
    }
  }
}

/** The «Parar» of the running notification. */
class SprintStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    SprintStop.record(context, System.currentTimeMillis(), "notification")
  }
}
