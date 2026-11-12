import { fromB64, randomBytes, toB64, utf8, fromUtf8 } from './encoding';

/**
 * Cofre: uma chave de dados aleatória (AES-256-GCM) cifra tudo. Essa chave nunca é guardada
 * em claro: ela fica "embrulhada" pela senha e por cada código de recuperação. Ao destravar,
 * a chave é importada como não-extraível e fica só na memória até o app travar.
 */

export const PASSWORD_ITERATIONS = 600_000; // recomendação OWASP para PBKDF2-SHA256
export const RECOVERY_ITERATIONS = 100_000; // código de recuperação já tem 120 bits de entropia

export interface KeyWrapper {
  id: string;
  kind: 'senha' | 'recuperacao';
  label: string;
  salt: string;
  iterations: number;
  iv: string;
  wrapped: string;
  createdAt: string;
}

export interface VaultHeader {
  format: 1;
  vaultId: string;
  createdAt: string;
  wrappers: KeyWrapper[];
  /** Hash da chave para conferir que um desembrulho deu certo sem cifrar nada. */
  check: { iv: string; ct: string };
}

export interface UnlockedVault {
  header: VaultHeader;
  key: CryptoKey;
}

const subtle = () => globalThis.crypto.subtle;

async function deriveKek(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', utf8(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function importDataKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapRaw(raw: Uint8Array<ArrayBuffer>, secret: string, kind: KeyWrapper['kind'], label: string): Promise<KeyWrapper> {
  const salt = randomBytes(16);
  const iterations = kind === 'senha' ? PASSWORD_ITERATIONS : RECOVERY_ITERATIONS;
  const kek = await deriveKek(kind === 'recuperacao' ? normalizeRecoveryCode(secret) : secret, salt, iterations);
  const iv = randomBytes(12);
  const wrapped = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`ficharedonda-key|${kind}`) }, kek, raw));
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    salt: toB64(salt),
    iterations,
    iv: toB64(iv),
    wrapped: toB64(wrapped),
    createdAt: new Date().toISOString(),
  };
}

async function unwrapRaw(w: KeyWrapper, secret: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const kek = await deriveKek(w.kind === 'recuperacao' ? normalizeRecoveryCode(secret) : secret, fromB64(w.salt), w.iterations);
    const raw = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(w.iv), additionalData: utf8(`ficharedonda-key|${w.kind}`) }, kek, fromB64(w.wrapped));
    return new Uint8Array(raw);
  } catch {
    return null;
  }
}

// Alfabeto Crockford base32: sem I, L, O e U para não confundir na hora de digitar.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCode(): string {
  const bytes = randomBytes(24);
  let code = '';
  for (let i = 0; i < 24; i++) code += ALPHABET[bytes[i]! % 32];
  return code.match(/.{4}/g)!.join('-');
}

export function normalizeRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Use pelo menos 10 caracteres. Uma frase com 3 ou 4 palavras funciona bem.');
  if (/^(.)\1+$/.test(password)) problems.push('Evite repetir o mesmo caractere.');
  if (/^(1234|senha|password|pizza|qwer)/i.test(password)) problems.push('Evite começos óbvios como "1234", "senha" ou "pizza".');
  return problems;
}

export interface CreatedVault extends UnlockedVault {
  recoveryCodes: [string, string];
}

export async function createVault(password: string): Promise<CreatedVault> {
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(problems[0]);
  const raw = randomBytes(32);
  const codes: [string, string] = [generateRecoveryCode(), generateRecoveryCode()];
  const wrappers = [
    await wrapRaw(raw, password, 'senha', 'Senha do cofre'),
    await wrapRaw(raw, codes[0], 'recuperacao', 'Código 1 (fica com você)'),
    await wrapRaw(raw, codes[1], 'recuperacao', 'Código 2 (envelope lacrado)'),
  ];
  const key = await importDataKey(raw);
  raw.fill(0);
  const vaultId = crypto.randomUUID();
  const checkIv = randomBytes(12);
  const check = await subtle().encrypt({ name: 'AES-GCM', iv: checkIv }, key, utf8(`ficharedonda|${vaultId}`));
  const header: VaultHeader = {
    format: 1,
    vaultId,
    createdAt: new Date().toISOString(),
    wrappers,
    check: { iv: toB64(checkIv), ct: toB64(new Uint8Array(check)) },
  };
  return { header, key, recoveryCodes: codes };
}

/** Destrava com a senha ou com qualquer código de recuperação. */
export async function unlockVault(header: VaultHeader, secret: string, kind: KeyWrapper['kind'] = 'senha'): Promise<UnlockedVault | null> {
  for (const w of header.wrappers.filter((x) => x.kind === kind)) {
    const raw = await unwrapRaw(w, secret);
    if (raw) {
      const key = await importDataKey(raw);
      raw.fill(0);
      return { header, key };
    }
  }
  return null;
}

/** Teste de recuperação: confere o código sem trocar nada. */
export async function verifyRecoveryCode(header: VaultHeader, code: string): Promise<string | null> {
  for (const w of header.wrappers.filter((x) => x.kind === 'recuperacao')) {
    const raw = await unwrapRaw(w, code);
    if (raw) {
      raw.fill(0);
      return w.id;
    }
  }
  return null;
}

/** Troca a senha (exige a senha atual ou um código de recuperação). */
export async function changePassword(header: VaultHeader, current: string, currentKind: KeyWrapper['kind'], next: string): Promise<VaultHeader> {
  const problems = passwordProblems(next);
  if (problems.length) throw new Error(problems[0]);
  const raw = await findRaw(header, current, currentKind);
  const wrapper = await wrapRaw(raw, next, 'senha', 'Senha do cofre');
  raw.fill(0);
  return { ...header, wrappers: [...header.wrappers.filter((w) => w.kind !== 'senha'), wrapper] };
}

/** Gera um código novo no lugar de um perdido. */
export async function replaceRecoveryCode(header: VaultHeader, password: string, wrapperId: string): Promise<{ header: VaultHeader; code: string }> {
  const old = header.wrappers.find((w) => w.id === wrapperId && w.kind === 'recuperacao');
  if (!old) throw new Error('Código não encontrado.');
  const raw = await findRaw(header, password, 'senha');
  const code = generateRecoveryCode();
  const wrapper = await wrapRaw(raw, code, 'recuperacao', old.label);
  raw.fill(0);
  return { header: { ...header, wrappers: header.wrappers.map((w) => (w.id === wrapperId ? wrapper : w)) }, code };
}

async function findRaw(header: VaultHeader, secret: string, kind: KeyWrapper['kind']): Promise<Uint8Array<ArrayBuffer>> {
  for (const w of header.wrappers.filter((x) => x.kind === kind)) {
    const raw = await unwrapRaw(w, secret);
    if (raw) return raw;
  }
  throw new Error(kind === 'senha' ? 'Senha incorreta.' : 'Código de recuperação incorreto.');
}

export interface Sealed {
  iv: string;
  ct: string;
}

export async function seal(key: CryptoKey, data: unknown, aad: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, utf8(JSON.stringify(data)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Compacta (gzip) quando o navegador sabe; o texto de extrato encolhe 4 a 10 vezes. */
export const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
/** Abaixo disso compactar não compensa o tempo (aprovações, ajustes: poucos bytes). */
export const COMPRESS_FROM = 2048;

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

/** Como `seal`, mas compacta antes de cifrar (compactar depois não adianta: dado cifrado não encolhe). */
export async function sealCompressed(key: CryptoKey, data: unknown, aad: string): Promise<Sealed> {
  const packed = await pipe(utf8(JSON.stringify(data)), new CompressionStream('gzip'));
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, packed);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function openCompressed<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: utf8(aad) }, key, fromB64(sealed.ct));
  return JSON.parse(fromUtf8(await pipe(new Uint8Array(pt), new DecompressionStream('gzip')))) as T;
}

export async function open<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: utf8(aad) }, key, fromB64(sealed.ct));
  return JSON.parse(fromUtf8(pt)) as T;
}

/**
 * "Lembrar este aparelho": a chave de dados é embrulhada por uma chave derivada do PIN
 * e, por cima, por uma chave do próprio aparelho que não pode ser exportada.
 * Cinco PINs errados apagam esse embrulho, e o app volta a pedir a senha forte.
 */
export const PIN_ITERATIONS = 600_000;
export const MAX_PIN_ATTEMPTS = 5;

export interface DeviceUnlock {
  deviceId: string;
  vaultId: string;
  /** Chave AES-GCM não-extraível do aparelho (guardada no IndexedDB por clonagem estruturada). */
  deviceKey: CryptoKey;
  salt: string;
  iv: string;
  outerIv: string;
  wrapped: string;
  failures: number;
  createdAt: string;
}

export function pinProblems(pin: string): string[] {
  if (!/^\d{6}$/.test(pin)) return ['O PIN precisa ter exatamente 6 números.'];
  if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return ['Escolha um PIN menos óbvio (sem sequências ou números repetidos).'];
  return [];
}

export async function enrollDevice(header: VaultHeader, password: string, pin: string, deviceId: string): Promise<DeviceUnlock> {
  const problems = pinProblems(pin);
  if (problems.length) throw new Error(problems[0]);
  const raw = await findRaw(header, password, 'senha');
  const salt = randomBytes(16);
  const pinKek = await deriveKek(pin, salt, PIN_ITERATIONS);
  const iv = randomBytes(12);
  const inner = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`ficharedonda-pin|${deviceId}`) }, pinKek, raw));
  raw.fill(0);
  const deviceKey = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const outerIv = randomBytes(12);
  const outer = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: outerIv }, deviceKey, inner));
  return {
    deviceId,
    vaultId: header.vaultId,
    deviceKey,
    salt: toB64(salt),
    iv: toB64(iv),
    outerIv: toB64(outerIv),
    wrapped: toB64(outer),
    failures: 0,
    createdAt: new Date().toISOString(),
  };
}

export type PinResult = { ok: true; key: CryptoKey } | { ok: false; attemptsLeft: number };

export async function unlockWithPin(device: DeviceUnlock, pin: string): Promise<PinResult> {
  if (device.failures >= MAX_PIN_ATTEMPTS) return { ok: false, attemptsLeft: 0 };
  try {
    const inner = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(device.outerIv) }, device.deviceKey, fromB64(device.wrapped));
    const pinKek = await deriveKek(pin, fromB64(device.salt), PIN_ITERATIONS);
    const raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(device.iv), additionalData: utf8(`ficharedonda-pin|${device.deviceId}`) }, pinKek, inner));
    const key = await importDataKey(raw);
    raw.fill(0);
    device.failures = 0;
    return { ok: true, key };
  } catch {
    device.failures += 1;
    return { ok: false, attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - device.failures) };
  }
}
