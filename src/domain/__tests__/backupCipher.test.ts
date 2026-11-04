import { randomBytes } from 'node:crypto';
import {
  asciiJson,
  bytesToAscii,
  createBackupKey,
  decryptBackup,
  DamagedBackupError,
  encryptBackup,
  fromBase64,
  keyForBackup,
  passwordProblem,
  readEncrypted,
  sameKdf,
  toBase64,
  utf8Bytes,
  WrongPasswordError,
} from '../backupCipher';
import { nodeKit } from './nodeCipherKit';

// Cheap cost so the tests run fast; the app uses DEFAULT_KDF.
const FAST = { name: 'pbkdf2-sha256', iterations: 1000 } as const;
const BACKUP = JSON.stringify({ app: 'entreno', tables: { routine: [{ name: 'Día 1: Torso (Empuje Pesado + Tirón Volumen)' }], note: 'ñandú 🏃' } });

describe('base64', () => {
  it('matches Node for every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(randomBytes(n));
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(fromBase64(Buffer.from(bytes).toString('base64')))).toEqual(Array.from(bytes));
    }
  });

  it('rejects what is not base64', () => {
    expect(() => fromBase64('ab$c')).toThrow(DamagedBackupError);
  });
});

describe('UTF-8 of the password', () => {
  it('matches Node, which the decrypt script uses', () => {
    for (const password of ['una frase bien larga', 'contraseña con ñ y tildes áé', 'emoji 🏃 también', '€ 𝄞']) {
      expect(Buffer.from(utf8Bytes(password)).equals(Buffer.from(password, 'utf8'))).toBe(true);
    }
  });
});

describe('ASCII JSON', () => {
  it('escapes accents and emoji, and parses back to the same thing', () => {
    const ascii = asciiJson(BACKUP);
    expect(/^[\x00-\x7f]*$/.test(ascii)).toBe(true);
    expect(ascii).toContain('D\\u00eda');
    expect(JSON.parse(ascii)).toEqual(JSON.parse(BACKUP));
  });

  it('turns long byte arrays back into text', () => {
    const text = 'x'.repeat(20_000) + 'fin';
    expect(bytesToAscii(new Uint8Array(Buffer.from(text, 'ascii')))).toBe(text);
  });
});

describe('encrypted backups', () => {
  it('open with the same password, from a new key derived from the backup itself', async () => {
    const key = await createBackupKey('una frase bien larga', nodeKit, FAST);
    const text = await encryptBackup(BACKUP, key, nodeKit);
    expect(text).not.toContain('Torso');
    const envelope = readEncrypted(text)!;
    expect(envelope.kdf).toEqual({ ...FAST, salt: key.kdf.salt });

    expect(JSON.parse(await decryptBackup(envelope, key, nodeKit))).toEqual(JSON.parse(BACKUP));
    // Another phone: only the password.
    const again = await keyForBackup(envelope, 'una frase bien larga', nodeKit);
    expect(sameKdf(again.kdf, key.kdf)).toBe(true);
    expect(JSON.parse(await decryptBackup(envelope, again, nodeKit))).toEqual(JSON.parse(BACKUP));
  });

  it('do not open with another password or after a change', async () => {
    const key = await createBackupKey('una frase bien larga', nodeKit, FAST);
    const envelope = readEncrypted(await encryptBackup(BACKUP, key, nodeKit))!;
    const wrong = await keyForBackup(envelope, 'otra frase bien larga', nodeKit);
    await expect(decryptBackup(envelope, wrong, nodeKit)).rejects.toThrow(WrongPasswordError);

    const bytes = fromBase64(envelope.data);
    bytes[20] ^= 1;
    await expect(decryptBackup({ ...envelope, data: toBase64(bytes) }, key, nodeKit)).rejects.toThrow(WrongPasswordError);
  });

  it('get a new salt each time a password is set', async () => {
    const a = await createBackupKey('una frase bien larga', nodeKit, FAST);
    const b = await createBackupKey('una frase bien larga', nodeKit, FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(sameKdf(a.kdf, b.kdf)).toBe(false);
  });

  it('normalize the password, so «ñ» typed either way is the same', async () => {
    const key = await createBackupKey('contraseña segura', nodeKit, FAST);
    const envelope = readEncrypted(await encryptBackup(BACKUP, key, nodeKit))!;
    const decomposed = await keyForBackup(envelope, 'contraseña segura'.normalize('NFD'), nodeKit);
    expect(JSON.parse(await decryptBackup(envelope, decomposed, nodeKit))).toEqual(JSON.parse(BACKUP));
  });
});

describe('telling backups apart', () => {
  it('a plain backup or anything else is not encrypted', () => {
    expect(readEncrypted(BACKUP)).toBeNull();
    expect(readEncrypted('no es json')).toBeNull();
    expect(readEncrypted('null')).toBeNull();
  });

  it('a damaged envelope says so', () => {
    expect(() => readEncrypted(JSON.stringify({ format: 'entreno-cifrada-1', cipher: 'AES-256-GCM' }))).toThrow(DamagedBackupError);
    // A copy asking for an absurd cost would freeze the phone deriving the key.
    const greedy = { format: 'entreno-cifrada-1', cipher: 'AES-256-GCM', data: 'AAAA', kdf: { name: 'pbkdf2-sha256', iterations: 1e9, salt: 'AAAA' } };
    expect(() => readEncrypted(JSON.stringify(greedy))).toThrow(DamagedBackupError);
  });
});

describe('new password', () => {
  it('needs 10 characters and the same twice', () => {
    expect(passwordProblem('corta', 'corta')).toBe('Al menos 10 caracteres');
    expect(passwordProblem('una frase larga', 'una frase larg')).toBe('Las dos contraseñas no coinciden');
    expect(passwordProblem('una frase larga', 'una frase larga')).toBeNull();
  });
});
