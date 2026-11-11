package expo.modules.resttimer

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log

/**
 * The GPS of the sprints, straight from the chip (PLAN.md §6.8, 1.5.2). The location the app gets
 * through expo-location is Google's fused one, which smooths for someone walking: in a sprint its
 * speed stays near 2 m/s and its positions run 2–3 s behind. This listens to `GPS_PROVIDER` itself,
 * as fast as the chip gives fixes, and keeps them until the JavaScript takes them. It lives as long
 * as the process: the foreground service of expo-location keeps both alive and allowed to locate
 * with the screen locked.
 */
object SprintGnss {
  private const val TAG = "Entreno"
  /** An hour and a half of fixes a second: far more than is ever left untaken. */
  private const val MAX_KEPT = 5_400

  private val kept = ArrayDeque<DoubleArray>()
  private var thread: HandlerThread? = null
  private var listener: LocationListener? = null
  private var logged = false

  @Synchronized
  fun running(): Boolean = listener != null

  /** True if it is listening (or already was). False without the precise location permission or a GPS. */
  @Synchronized
  fun start(context: Context): Boolean {
    if (listener != null) return true
    val app = context.applicationContext
    if (app.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false
    val manager = app.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
    if (!manager.allProviders.contains(LocationManager.GPS_PROVIDER)) return false
    val worker = HandlerThread("sprint-gnss").apply { start() }
    val callback = object : LocationListener {
      override fun onLocationChanged(location: Location) = keep(location)

      // Abstract before Android 11.
      @Deprecated("Deprecated in Java")
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

      override fun onProviderEnabled(provider: String) = Unit

      override fun onProviderDisabled(provider: String) = Unit
    }
    return try {
      // No minimum time or distance: every fix the chip computes (one a second on most phones).
      manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, callback, worker.looper)
      thread = worker
      listener = callback
      logged = false
      Log.i(TAG, "[sprint] gnss en marcha")
      true
    } catch (e: SecurityException) {
      worker.quitSafely()
      false
    } catch (e: IllegalArgumentException) {
      worker.quitSafely()
      false
    }
  }

  @Synchronized
  fun stop(context: Context) {
    val callback = listener ?: return
    val manager = context.applicationContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    try {
      manager?.removeUpdates(callback)
    } catch (e: SecurityException) {
      // Nothing to remove without the permission.
    }
    thread?.quitSafely()
    thread = null
    listener = null
    kept.clear()
    Log.i(TAG, "[sprint] gnss parado")
  }

  /**
   * The fixes kept since the last call, oldest first, each as
   * `[t, lat, lon, accuracy, speed, speedAccuracy, clockLag]`; -1 where the chip gave no value.
   * `t` is the instant of the fix on the clock of the taps (`System.currentTimeMillis()`), from its
   * time since boot, so a system clock that is off from GPS time does not shift the sprint;
   * `clockLag` is how far the fix's own (GPS) time runs behind that.
   */
  @Synchronized
  fun take(): List<DoubleArray> {
    val all = kept.toList()
    kept.clear()
    return all
  }

  @Synchronized
  private fun keep(location: Location) {
    val ageMs = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000.0
    val t = System.currentTimeMillis() - ageMs
    val speedAccuracy =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasSpeedAccuracy()) location.speedAccuracyMetersPerSecond.toDouble() else -1.0
    kept.addLast(
      doubleArrayOf(
        t,
        location.latitude,
        location.longitude,
        if (location.hasAccuracy()) location.accuracy.toDouble() else -1.0,
        if (location.hasSpeed()) location.speed.toDouble() else -1.0,
        speedAccuracy,
        t - location.time,
      ),
    )
    while (kept.size > MAX_KEPT) kept.removeFirst()
    if (!logged) {
      logged = true
      Log.i(TAG, "[sprint] gnss primer punto: ±${location.accuracy} m, reloj ${(t - location.time).toLong()} ms")
    }
  }
}
