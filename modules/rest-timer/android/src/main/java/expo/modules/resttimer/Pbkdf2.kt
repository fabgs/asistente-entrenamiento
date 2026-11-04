package expo.modules.resttimer

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PBKDF2-HMAC-SHA256 (RFC 8018) for one 32-byte block, on the password's own bytes (UTF-8 from JS).
 * Written out instead of SecretKeyFactory because that one turns the password into chars, and how
 * it encodes them back differs between providers. Node's crypto.pbkdf2 gives the same result.
 */
internal object Pbkdf2 {
  fun sha256(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
    require(iterations > 0) { "iterations" }
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(password, "HmacSHA256"))
    mac.update(salt)
    mac.update(byteArrayOf(0, 0, 0, 1))
    var u = mac.doFinal()
    val result = u.copyOf()
    for (i in 1 until iterations) {
      u = mac.doFinal(u)
      for (j in result.indices) result[j] = (result[j].toInt() xor u[j].toInt()).toByte()
    }
    return result
  }
}
