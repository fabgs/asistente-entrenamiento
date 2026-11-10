package expo.modules.resttimer

import android.content.Context
import android.os.SystemClock
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

/**
 * Hooks of the app's activity (autolinked by Expo: a class named …Package that implements Package).
 * While a sprint is running, the volume buttons stop it instead of changing the volume (PLAN.md
 * §6.8, 1.5.0). Android only sends them to the app while it is in front, also over the lock screen.
 */
class RestTimerPackage : Package {
  // Called from the activity's constructor: it has no application context yet, so the activity itself is kept.
  override fun createReactActivityHandlers(activityContext: Context): List<ReactActivityHandler> =
    listOf(SprintKeys(activityContext))
}

private class SprintKeys(private val context: Context) : ReactActivityHandler {
  private fun isVolume(keyCode: Int) = keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    if (!isVolume(keyCode) || !SprintStop.capturing()) return false
    if (event != null && event.repeatCount == 0) {
      // The press, not now: the event may have waited in the queue.
      val at = System.currentTimeMillis() - (SystemClock.uptimeMillis() - event.eventTime)
      SprintStop.record(context, at, "volume")
    }
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean = isVolume(keyCode) && SprintStop.capturing()

  override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean = isVolume(keyCode) && SprintStop.capturing()
}
