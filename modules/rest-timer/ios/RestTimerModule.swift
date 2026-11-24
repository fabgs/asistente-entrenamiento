import CommonCrypto
import ExpoModulesCore

/**
 * The app's own native module on iOS (1.5.5). For now only the key of the encrypted copies: without
 * it a copy made on Android cannot be opened here. The rest of `rest-timer` (lock-screen countdown,
 * sprint beep, GPS chip, volume buttons) is Android only; the JS side does nothing when a function
 * is missing.
 */
public class RestTimerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RestTimer")

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
