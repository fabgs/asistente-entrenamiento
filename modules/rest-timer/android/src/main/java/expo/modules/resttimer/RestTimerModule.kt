package expo.modules.resttimer

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RestTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RestTimer")

    Function("start") { endsAt: Double, title: String, body: String, overlay: Boolean ->
      RestTimerService.start(context, endsAt.toLong(), title, body, overlay)
    }

    Function("stop") {
      RestTimerService.stop(context)
    }

    Function("canDrawOverlays") {
      RestTimerService.canDrawOverlays(context)
    }

    // False while battery optimization can delay the alarms and stop the countdown service.
    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    OnActivityEntersForeground {
      RestTimerService.setAppInForeground(true)
    }

    OnActivityEntersBackground {
      RestTimerService.setAppInForeground(false)
    }
  }
}
