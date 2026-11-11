package expo.modules.resttimer

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.util.Base64
import android.view.WindowManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RestTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RestTimer")

    // A sprint stopped with a volume button or the notification's «Parar» (1.5.0): at once while
    // the JavaScript is alive; `takeSprintStop` returns it anyway, also after a restart.
    Events("onSprintStop")

    OnCreate {
      SprintStop.listener = { at, source -> sendEvent("onSprintStop", mapOf("at" to at.toDouble(), "source" to source)) }
    }

    OnDestroy {
      SprintStop.listener = null
    }

    Function("start") { endsAt: Double, title: String, body: String, overlay: Boolean ->
      RestTimerService.start(context, endsAt.toLong(), title, body, overlay)
    }

    Function("stop") {
      RestTimerService.stop(context)
    }

    Function("startOngoing") { startedAt: Double, title: String, body: String ->
      RestTimerService.startOngoing(context, startedAt.toLong(), title, body)
    }

    Function("stopOngoing") {
      RestTimerService.stopOngoing()
    }

    // The sprint start beep, played natively at `goAt` (PLAN.md §6.8). Calling it again with the
    // same start changes nothing; with another one, moves it.
    Function("scheduleSprintBeep") { goAt: Double ->
      SprintBeep.schedule(context, goAt.toLong())
    }

    Function("cancelSprintBeep") {
      SprintBeep.cancel(context)
    }

    Function("startSprintRunning") { startAt: Double, title: String, body: String, minMs: Double ->
      RestTimerService.startSprintRunning(context, startAt.toLong(), title, body, minMs.toLong())
    }

    Function("stopSprintRunning") {
      RestTimerService.stopSprintRunning()
    }

    // The stop kept, as {at, source}, or null; each is returned once.
    Function("takeSprintStop") {
      SprintStop.take(context)?.let { (at, source) -> mapOf("at" to at.toDouble(), "source" to source) }
    }

    // The GPS of the sprints straight from the chip (1.5.2): the fused location smooths a sprint away.
    Function("startSprintGnss") {
      SprintGnss.start(context)
    }

    Function("stopSprintGnss") {
      SprintGnss.stop(context)
    }

    // The fixes kept since the last call, as rows of numbers (see `SprintGnss.take`); null when it is not listening.
    Function("takeSprintGnss") {
      if (SprintGnss.running()) SprintGnss.take().map { it.toList() } else null
    }

    // The key of the encrypted copies (PLAN.md §9); async, so it runs off the JS thread.
    AsyncFunction("pbkdf2Sha256") { password: String, salt: String, iterations: Int ->
      val key = Pbkdf2.sha256(Base64.decode(password, Base64.NO_WRAP), Base64.decode(salt, Base64.NO_WRAP), iterations)
      Base64.encodeToString(key, Base64.NO_WRAP)
    }

    Function("canDrawOverlays") {
      RestTimerService.canDrawOverlays(context)
    }

    // False while battery optimization can delay the alarms and stop the countdown service.
    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Shows the sprints screen over the lock screen while it is focused: power button, then «Parar»
    // without the PIN. Only that screen turns it on, and it turns it off when it loses focus.
    Function("setShowWhenLocked") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          activity.setShowWhenLocked(on)
        } else if (on) {
          @Suppress("DEPRECATION")
          activity.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        } else {
          @Suppress("DEPRECATION")
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        }
      }
    }

    OnActivityEntersForeground {
      RestTimerService.setAppInForeground(true)
    }

    OnActivityEntersBackground {
      RestTimerService.setAppInForeground(false)
    }
  }
}
