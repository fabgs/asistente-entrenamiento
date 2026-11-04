#!/usr/bin/env node
// Descifra una copia cifrada de Entreno (PLAN.md §9) con Node, sin dependencias.
//
//   node scripts/decrypt-backup.mjs copia.json > copia-descifrada.json
//
// Pide la contraseña sin mostrarla (o la toma de ENTRENO_PASSWORD). El resultado es el JSON de
// siempre, el que «Importar copia» acepta. No lo guardes dentro del repositorio.
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('Uso: node scripts/decrypt-backup.mjs <copia.json> > descifrada.json');
  process.exit(2);
}

const envelope = JSON.parse(readFileSync(file, 'utf8'));
if (envelope.format !== 'entreno-cifrada-1') {
  console.error('No es una copia cifrada de Entreno (¿ya está sin cifrar?).');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    // Hides what is typed.
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) process.stderr.write(question);
    };
  });
}

const password = process.env.ENTRENO_PASSWORD ?? (await askHidden('Contraseña: '));
const { name, iterations, salt } = envelope.kdf;
if (name !== 'pbkdf2-sha256') {
  console.error(`No sé derivar la clave con «${name}».`);
  process.exit(1);
}
const key = pbkdf2Sync(Buffer.from(password.normalize('NFC'), 'utf8'), Buffer.from(salt, 'base64'), iterations, 32, 'sha256');

// IV (12) · ciphertext · tag (16), as expo-crypto's `combined()`.
const sealed = Buffer.from(envelope.data, 'base64');
const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
decipher.setAuthTag(sealed.subarray(sealed.length - 16));
try {
  const plain = Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
  process.stdout.write(plain.toString('utf8'));
} catch {
  console.error('La contraseña no es correcta o la copia está dañada.');
  process.exit(1);
}
