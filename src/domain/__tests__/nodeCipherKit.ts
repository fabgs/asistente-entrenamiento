import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';
import { fromBase64, toBase64, type CipherKit } from '../backupCipher';

/** The same layout as expo-crypto's `combined()`: IV (12) · ciphertext · tag (16). */
export const nodeKit: CipherKit = {
  randomBytes: (n) => new Uint8Array(randomBytes(n)),
  deriveKey: (password, salt, { iterations }) =>
    new Promise((resolve, reject) =>
      pbkdf2(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256', (e, key) => (e ? reject(e) : resolve(new Uint8Array(key)))),
    ),
  seal: async (key, plaintext) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return toBase64(new Uint8Array(Buffer.concat([iv, body, cipher.getAuthTag()])));
  },
  open: async (key, sealed) => {
    const all = Buffer.from(fromBase64(sealed));
    const decipher = createDecipheriv('aes-256-gcm', key, all.subarray(0, 12));
    decipher.setAuthTag(all.subarray(all.length - 16));
    return new Uint8Array(Buffer.concat([decipher.update(all.subarray(12, all.length - 16)), decipher.final()]));
  },
};
