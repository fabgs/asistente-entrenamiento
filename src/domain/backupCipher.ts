/**
 * Encrypted backups (PLAN.md §9): the backup JSON sealed with AES-256-GCM under a key derived
 * from the user's password with PBKDF2-HMAC-SHA256. The envelope is JSON too, so GitHub keeps one file and
 * `scripts/decrypt-backup.mjs` can open it on a computer with Node alone.
 */

export const ENCRYPTED_FORMAT = 'entreno-cifrada-1';
export const MIN_PASSWORD_LENGTH = 10;

/**
 * 600 000 iterations, as OWASP advises for PBKDF2-HMAC-SHA256. Computed natively (about a second);
 * scrypt in JavaScript took ~50 s on the OnePlus. It only runs when the password is set or a copy
 * from another phone is opened: the derived key is kept in the Keystore.
 */
export const DEFAULT_KDF = { name: 'pbkdf2-sha256', iterations: 600_000 } as const;
/** A copy asking for more than this is not trusted: it would freeze the phone. */
const MAX_ITERATIONS = 10_000_000;

export interface KdfParams {
  name: 'pbkdf2-sha256';
  iterations: number;
  /** base64, 16 random bytes. */
  salt: string;
}

export interface BackupKey {
  kdf: KdfParams;
  /** 32 bytes. */
  key: Uint8Array;
}

export interface EncryptedBackup {
  app: 'entreno';
  format: typeof ENCRYPTED_FORMAT;
  kdf: KdfParams;
  cipher: 'AES-256-GCM';
  /** base64 of IV (12 bytes) · ciphertext · tag (16 bytes). */
  data: string;
}

/** The primitives, native in the app and from `node:crypto` in the tests and the script. */
export interface CipherKit {
  randomBytes(count: number): Uint8Array;
  deriveKey(password: string, salt: Uint8Array, kdf: Omit<KdfParams, 'salt'>): Promise<Uint8Array>;
  /** base64 of IV · ciphertext · tag. */
  seal(key: Uint8Array, plaintext: Uint8Array): Promise<string>;
  /** Throws if the key is wrong or the data was changed. */
  open(key: Uint8Array, sealed: string): Promise<Uint8Array>;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('La contraseña no es correcta.');
  }
}

export class DamagedBackupError extends Error {
  constructor() {
    super('La copia cifrada está dañada o incompleta.');
  }
}

/** Why a new password is not valid yet, or null. */
export function passwordProblem(password: string, repeated: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  if (password !== repeated) return 'Las dos contraseñas no coinciden';
  return null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const left = bytes.length - i;
    const n = (bytes[i] << 16) | ((left > 1 ? bytes[i + 1] : 0) << 8) | (left > 2 ? bytes[i + 2] : 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += left > 1 ? ALPHABET[(n >> 6) & 63] : '=';
    out += left > 2 ? ALPHABET[n & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const char of clean) {
    const v = ALPHABET.indexOf(char);
    if (v < 0) throw new DamagedBackupError();
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 255;
    }
  }
  return out;
}

/**
 * The same JSON with every non-ASCII character escaped (`á` → `á`), so its bytes are its
 * characters and no UTF-8 encoder is needed. `JSON.parse` reads it back unchanged.
 */
export function asciiJson(json: string): string {
  return json.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** UTF-8 by hand: the password may have «ñ» or accents, and this does not depend on TextEncoder. */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const c = char.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) throw new Error('Texto no ASCII');
    out[i] = code;
  }
  return out;
}

export function bytesToAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

export const sameKdf = (a: KdfParams, b: KdfParams): boolean =>
  a.name === b.name && a.iterations === b.iterations && a.salt === b.salt;

/** The envelope if `text` is an encrypted backup, null if it is something else (a plain backup). */
export function readEncrypted(text: string): EncryptedBackup | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== ENCRYPTED_FORMAT) return null;
  const e = json as Partial<EncryptedBackup>;
  const kdf = e.kdf as Partial<KdfParams> | undefined;
  const ok =
    e.cipher === 'AES-256-GCM' &&
    typeof e.data === 'string' &&
    kdf?.name === 'pbkdf2-sha256' &&
    typeof kdf.salt === 'string' &&
    Number.isInteger(kdf.iterations) &&
    (kdf.iterations as number) > 0 &&
    (kdf.iterations as number) <= MAX_ITERATIONS;
  if (!ok) throw new DamagedBackupError();
  return e as EncryptedBackup;
}

async function derive(password: string, kdf: KdfParams, kit: CipherKit): Promise<BackupKey> {
  const { salt, ...cost } = kdf;
  return { kdf, key: await kit.deriveKey(password.normalize('NFC'), fromBase64(salt), cost) };
}

/** A key for a new password, with a fresh salt. */
export function createBackupKey(password: string, kit: CipherKit, cost: Omit<KdfParams, 'salt'> = DEFAULT_KDF): Promise<BackupKey> {
  return derive(password, { ...cost, salt: toBase64(kit.randomBytes(16)) }, kit);
}

/** The key of a backup made with `password`, from its own salt and cost. */
export function keyForBackup(envelope: EncryptedBackup, password: string, kit: CipherKit): Promise<BackupKey> {
  return derive(password, envelope.kdf, kit);
}

/** The envelope (JSON text) for a plain backup JSON. */
export async function encryptBackup(json: string, key: BackupKey, kit: CipherKit): Promise<string> {
  const envelope: EncryptedBackup = {
    app: 'entreno',
    format: ENCRYPTED_FORMAT,
    kdf: key.kdf,
    cipher: 'AES-256-GCM',
    data: await kit.seal(key.key, asciiBytes(asciiJson(json))),
  };
  return JSON.stringify(envelope);
}

/** The plain backup JSON; WrongPasswordError if the key does not open it. */
export async function decryptBackup(envelope: EncryptedBackup, key: BackupKey, kit: CipherKit): Promise<string> {
  let plain: Uint8Array;
  try {
    plain = await kit.open(key.key, envelope.data);
  } catch {
    throw new WrongPasswordError();
  }
  return bytesToAscii(plain);
}
