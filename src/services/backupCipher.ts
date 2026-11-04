import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fromBase64, toBase64, utf8Bytes, type BackupKey, type CipherKit, type KdfParams } from '@/domain/backupCipher';
import { pbkdf2Sha256 } from '../../modules/rest-timer';

const importKey = async (bytes: Uint8Array) => (await AESEncryptionKey.import(bytes)) as AESEncryptionKey;

/** Everything native: AES-GCM from expo-crypto and PBKDF2 from the app's own module. */
export const appKit: CipherKit = {
  randomBytes: (count) => getRandomBytes(count),
  deriveKey: async (password, salt, { iterations }) => {
    const key = await pbkdf2Sha256(toBase64(utf8Bytes(password)), toBase64(salt), iterations);
    if (key === null) throw new Error('Esta versión de la app no puede cifrar copias: actualízala.');
    return fromBase64(key);
  },
  seal: async (key, plaintext) => (await aesEncryptAsync(plaintext, await importKey(key))).combined('base64'),
  open: async (key, sealed) => aesDecryptAsync(AESSealedData.fromCombined(sealed), await importKey(key)),
};

const KEY_ITEM = 'backup-key';

/**
 * The derived key, in the Keystore (expo-secure-store): automatic backups encrypt with it without
 * asking for the password. The password itself is never stored.
 */
export const backupKeyStore = {
  async get(): Promise<BackupKey | null> {
    const raw = await SecureStore.getItemAsync(KEY_ITEM);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { kdf: KdfParams; key: string };
    return { kdf: stored.kdf, key: fromBase64(stored.key) };
  },
  set: (key: BackupKey) => SecureStore.setItemAsync(KEY_ITEM, JSON.stringify({ kdf: key.kdf, key: toBase64(key.key) })),
  clear: () => SecureStore.deleteItemAsync(KEY_ITEM),
};
