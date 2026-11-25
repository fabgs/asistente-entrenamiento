import CommonCrypto
import ExpoModulesCore

/** A walk for the Live Activity: what `liveWalk` (src/domain/liveActivity.ts) works out. */
struct CardioActivityRecord: Record {
  @Field var activeStart: Double = 0
  @Field var paused: Bool = false
  @Field var still: String? = nil
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var metric: String? = nil
  @Field var symbol: String = "figure.walk"
}

/**
 * The app's own native module on iOS: the key of the encrypted copies (1.5.5; without it a copy made
 * on Android cannot be opened here) and, since 1.5.7, the Live Activity, through the same functions
 * Android uses for its fixed notification (LiveActivities.swift). The sprint beep, the GPS chip and
 * the volume buttons are Android only; the JS side does nothing when a function is missing.
 */
public class RestTimerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RestTimer")

    // The rest, the phases or the wait for a sprint: a countdown on the lock screen and in the island.
    Function("start") { (endsAt: Double, title: String, body: String, _: Bool) in
      LiveActivities.shared.countdown(endsAt: endsAt, title: title, body: body)
    }

    Function("stop") {
      LiveActivities.shared.stopCountdown()
    }

    Function("startOngoing") { (startedAt: Double, title: String, body: String) in
      LiveActivities.shared.ongoing(startedAt: startedAt, title: title, body: body)
    }

    Function("stopOngoing") {
      LiveActivities.shared.endAll()
    }

    Function("startSprintRunning") { (startAt: Double, title: String, body: String, _: Double) in
      LiveActivities.shared.sprint(startAt: startAt, title: title, body: body)
    }

    Function("stopSprintRunning") {
      LiveActivities.shared.stopSprint()
    }

    Function("showCardioActivity") { (walk: CardioActivityRecord) in
      LiveActivities.shared.cardio(
        activeStart: walk.activeStart,
        paused: walk.paused,
        still: walk.still,
        title: walk.title,
        body: walk.body,
        metric: walk.metric,
        symbol: walk.symbol
      )
    }

    Function("endLiveActivities") {
      LiveActivities.shared.endAll()
    }

    // PBKDF2-HMAC-SHA256 with a 32-byte result, as Pbkdf2.kt and Node's crypto.pbkdf2: on the
    // password's own bytes (UTF-8 from JS). Password and salt in base64, the key in base64. Async,
    // so the 600 000 iterations run off the JS thread.
    AsyncFunction("pbkdf2Sha256") { (password: String, salt: String, iterations: Int) throws -> String in
      guard let pass = Data(base64Encoded: password), let saltBytes = Data(base64Encoded: salt), iterations > 0 else {
        throw Pbkdf2Exception()
      }
      var key = Data(count: 32)
      let keyLength = key.count
      let status = key.withUnsafeMutableBytes { keyBuffer in
        saltBytes.withUnsafeBytes { saltBuffer in
          pass.withUnsafeBytes { passBuffer in
            CCKeyDerivationPBKDF(
              CCPBKDFAlgorithm(kCCPBKDF2),
              passBuffer.bindMemory(to: Int8.self).baseAddress,
              pass.count,
              saltBuffer.bindMemory(to: UInt8.self).baseAddress,
              saltBytes.count,
              CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
              UInt32(iterations),
              keyBuffer.bindMemory(to: UInt8.self).baseAddress,
              keyLength
            )
          }
        }
      }
      guard status == Int32(kCCSuccess) else {
        throw Pbkdf2Exception()
      }
      return key.base64EncodedString()
    }
  }
}

internal final class Pbkdf2Exception: Exception {
  override var reason: String {
    "No se pudo calcular la clave de las copias"
  }
}
