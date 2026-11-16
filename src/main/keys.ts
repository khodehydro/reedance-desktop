import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SafeStorage } from "electron";
import type { KeyRecord, PackKeyInfo, PackKeySource } from "../shared/types";
import { fromBase64Url, sha256Hex, toBase64Url } from "./crypto/pack";
import { ed25519PrivateKeyFromSeed, ed25519PublicKeyRaw, generateSigningKeyPair } from "./crypto/sign";
import { keysDir, writeFileAtomic } from "./paths";

/**
 * Key storage for the studio.
 *
 * The Ed25519 private key never leaves the operator machine and is never
 * embedded in the installer; symmetric AES-256 keys are equally local. Both
 * are stored in `keys/keystore.json`, encrypted with Electron `safeStorage`
 * (DPAPI on Windows). When the OS keyring is unavailable the keystore falls
 * back to plain JSON and the UI shows a warning instead of pretending the key
 * is protected. `keyId`s are public identifiers only — no key bytes are ever
 * logged, written to the database, or placed in an export artifact.
 */
interface StoredKey {
  keyId: string;
  kind: "enc" | "sig";
  createdAt: string;
  testOnly: boolean;
  protection: "safeStorage" | "none";
  secret: string;
  publicKeyBase64url?: string;
}

interface KeyFile {
  version: 1;
  keys: StoredKey[];
}

const KEY_ID = /^(enc|sig)-[a-z0-9-]+$/;

function keystorePath(): string {
  return path.join(keysDir(), "keystore.json");
}

/**
 * The `.rdpack` AES-256 key is a *distribution key*, not an operator secret.
 *
 * Windows Studio encrypts every export with one key identified in the pack
 * header as `enc-main`, and the Reedance Android app is built with the matching
 * key. Nothing is asked from the operator: no password, no passphrase, no key
 * picker, no copy/paste between the two apps.
 *
 * Resolution order (first match wins):
 *   1. `REEDANCE_ENC_MAIN_KEY` environment variable (32 bytes, see below)
 *   2. `keys/enc-main.key` — same text form, or exactly 32 raw bytes (mode 0600)
 *   3. the `enc-main` record in the local keystore (Settings → import key file)
 *   4. the published TEST key, so a fresh install can export straight away
 *
 * Accepted text forms: hex (64 chars), base64url or base64 of the 32 raw bytes.
 * The TEST key is public on purpose — it also lives in the Android test
 * fixtures and in docs/CRYPTO.md. Exports made with it are flagged
 * `usedTestKeys` and must not be published; a real key is never committed.
 */
export const PACK_KEY_ID = "enc-main";
export const TEST_PACK_KEY_LABEL = "reedance-test-enc-main-v1";

export function testPackKey(): Buffer {
  return crypto.createHash("sha256").update(TEST_PACK_KEY_LABEL, "utf8").digest();
}

export function packKeyPath(): string {
  return path.join(keysDir(), "enc-main.key");
}

/** Accept 32 raw bytes, or the hex / base64 / base64url text of those bytes. */
export function parseKeyMaterial(input: Buffer | string): Buffer | null {
  let raw = input;
  if (Buffer.isBuffer(raw) && raw.length === 32) return Buffer.from(raw);
  const text = (Buffer.isBuffer(raw) ? raw.toString("utf8") : raw).trim();
  if (!text) return null;
  if (/^[a-fA-F0-9]{64}$/.test(text)) return Buffer.from(text, "hex");
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) {
    const decoded = fromBase64Url(text);
    return decoded.length === 32 ? decoded : null;
  }
  if (/^[A-Za-z0-9+/]{43}=?$/.test(text)) {
    const decoded = Buffer.from(text, "base64");
    return decoded.length === 32 ? decoded : null;
  }
  return null;
}

export function resolvePackKey(): { key: Buffer; source: PackKeySource } {
  const fromEnv = process.env.REEDANCE_ENC_MAIN_KEY;
  if (fromEnv && fromEnv.trim()) {
    const key = parseKeyMaterial(fromEnv);
    if (!key) throw new Error("REEDANCE_ENC_MAIN_KEY must hold a 32-byte key as base64url, base64 or hex");
    return { key, source: "env" };
  }

  let fileBytes: Buffer | null = null;
  try {
    fileBytes = fs.readFileSync(packKeyPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (fileBytes && fileBytes.length > 0) {
    const key = parseKeyMaterial(fileBytes);
    if (!key) throw new Error(`${packKeyPath()} must hold a 32-byte key as base64url, base64 or hex`);
    return { key, source: "file" };
  }

  const stored = load().keys.find((candidate) => candidate.keyId === PACK_KEY_ID && candidate.kind === "enc");
  if (stored) {
    const raw = unprotect(stored);
    if (raw.length !== 32) throw new Error("the stored enc-main key is corrupt");
    return { key: raw, source: "keystore" };
  }

  return { key: testPackKey(), source: "test" };
}

/** The AES-256 key used for packs; test-key fallback is signalled separately. */
export function getPackKey(): Buffer {
  return resolvePackKey().key;
}

/** Non-secret description of the pack key, safe to show in the UI. */
export function packKeyInfo(): PackKeyInfo {
  const base = { keyId: PACK_KEY_ID, keyFile: packKeyPath() };
  try {
    const { key, source } = resolvePackKey();
    return {
      ...base,
      source,
      testOnly: source === "test",
      fingerprint: sha256Hex(key).slice(0, 16),
    };
  } catch (error) {
    return {
      ...base,
      source: "test",
      testOnly: true,
      fingerprint: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function osKeystore(): SafeStorage | null {
  try {
    const loaded = require("electron") as { safeStorage?: SafeStorage };
    return loaded.safeStorage ?? null;
  } catch {
    return null;
  }
}

function encryptionAvailable(): boolean {
  try {
    return osKeystore()?.isEncryptionAvailable() ?? false;
  } catch {
    return false;
  }
}

function protect(raw: Buffer): { secret: string; protection: StoredKey["protection"] } {
  const keystore = osKeystore();
  if (keystore && encryptionAvailable()) {
    const encrypted = keystore.encryptString(raw.toString("base64"));
    return { secret: encrypted.toString("base64"), protection: "safeStorage" };
  }
  return { secret: raw.toString("base64"), protection: "none" };
}

function unprotect(key: StoredKey): Buffer {
  if (key.protection === "safeStorage") {
    const keystore = osKeystore();
    if (!keystore) throw new Error("the operating system keystore is unavailable; import the key again");
    const decoded = keystore.decryptString(Buffer.from(key.secret, "base64"));
    return Buffer.from(decoded, "base64");
  }
  return Buffer.from(key.secret, "base64");
}

function load(): KeyFile {
  try {
    const raw = fs.readFileSync(keystorePath(), "utf8");
    const parsed = JSON.parse(raw) as KeyFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.keys)) throw new Error("unsupported keystore");
    return parsed;
  } catch {
    return { version: 1, keys: [] };
  }
}

function save(file: KeyFile): void {
  writeFileAtomic(keystorePath(), JSON.stringify(file, null, 2), 0o600);
}

function fingerprint(raw: Buffer): string {
  return sha256Hex(raw).slice(0, 16);
}

export function listKeys(): KeyRecord[] {
  return load().keys.map((key) => {
    let fp: string | undefined;
    try {
      const secret = unprotect(key);
      fp = key.kind === "sig" ? fingerprint(ed25519PublicKeyRaw(ed25519PrivateKeyFromSeed(secret))) : fingerprint(secret);
    } catch {
      fp = undefined;
    }
    return {
      keyId: key.keyId,
      kind: key.kind,
      createdAt: key.createdAt,
      testOnly: key.testOnly,
      protection: key.protection,
      publicKeyBase64url: key.publicKeyBase64url,
      fingerprint: fp,
    };
  });
}

function upsert(file: KeyFile, key: StoredKey): void {
  const index = file.keys.findIndex((candidate) => candidate.keyId === key.keyId);
  if (index >= 0) file.keys[index] = key;
  else file.keys.push(key);
}

function randomSuffix(): string {
  return crypto.randomBytes(3).toString("hex");
}

/** Create local TEST-ONLY keys so the whole pipeline can be exercised safely. */
export function generateTestKeys(): KeyRecord[] {
  const file = load();
  const hasEnc = file.keys.some((key) => key.kind === "enc");
  const hasSig = file.keys.some((key) => key.kind === "sig");
  if (!hasEnc) {
    const aes = crypto.randomBytes(32);
    const { secret, protection } = protect(aes);
    upsert(file, {
      keyId: `enc-test-${randomSuffix()}`,
      kind: "enc",
      createdAt: new Date().toISOString(),
      testOnly: true,
      protection,
      secret,
    });
  }
  if (!hasSig) {
    const { seed, publicRaw } = generateSigningKeyPair();
    const { secret, protection } = protect(seed);
    upsert(file, {
      keyId: `sig-test-${randomSuffix()}`,
      kind: "sig",
      createdAt: new Date().toISOString(),
      testOnly: true,
      protection,
      secret,
      publicKeyBase64url: toBase64Url(publicRaw),
    });
  }
  save(file);
  return listKeys();
}

/**
 * Zero-configuration keys.
 *
 * The operator should not have to create, pick or confirm key material: the app
 * provisions one AES-256 key and one Ed25519 key on first use, keeps them in the
 * OS keystore and reuses them for every export. Only a passphrase backup stays
 * optional in Settings.
 */
export function ensureStudioKeys(): { encryptionKeyId: string; signatureKeyId: string } {
  const file = load();
  let changed = false;
  // The AES key is a provisioned distribution key (see resolvePackKey); only
  // the signing key is stored here, and even that is invisible to the operator.
  let sig = file.keys.find((key) => key.kind === "sig" && !key.testOnly);
  if (!sig) {
    const { seed, publicRaw } = generateSigningKeyPair();
    const { secret, protection } = protect(seed);
    sig = {
      keyId: `sig-studio-${randomSuffix()}`,
      kind: "sig",
      createdAt: new Date().toISOString(),
      testOnly: false,
      protection,
      secret,
      publicKeyBase64url: toBase64Url(publicRaw),
    };
    upsert(file, sig);
    changed = true;
  }
  if (changed) save(file);
  return { encryptionKeyId: PACK_KEY_ID, signatureKeyId: sig.keyId };
}

export interface ImportedKeyFile {
  encryptionKeyId?: string;
  aes256KeyBase64url?: string;
  signatureKeyId?: string;
  ed25519SeedBase64url?: string;
  ed25519PrivateKeyPem?: string;
  testOnly?: boolean;
}

/** Import operator-supplied key material from a JSON file (never logged). */
export function importKeys(text: string): KeyRecord[] {
  let parsed: ImportedKeyFile;
  try {
    parsed = JSON.parse(text) as ImportedKeyFile;
  } catch {
    throw new Error("key file is not valid JSON");
  }
  const file = load();
  if (parsed.encryptionKeyId && parsed.aes256KeyBase64url) {
    if (!KEY_ID.test(parsed.encryptionKeyId) || !parsed.encryptionKeyId.startsWith("enc-")) {
      throw new Error("encryptionKeyId must look like enc-<slug>");
    }
    const key = fromBase64Url(parsed.aes256KeyBase64url);
    if (key.length !== 32) throw new Error("AES-256 keys must be exactly 32 bytes");
    const { secret, protection } = protect(key);
    upsert(file, {
      keyId: parsed.encryptionKeyId,
      kind: "enc",
      createdAt: new Date().toISOString(),
      testOnly: parsed.testOnly === true,
      protection,
      secret,
    });
  }
  if (parsed.signatureKeyId && (parsed.ed25519SeedBase64url || parsed.ed25519PrivateKeyPem)) {
    if (!KEY_ID.test(parsed.signatureKeyId) || !parsed.signatureKeyId.startsWith("sig-")) {
      throw new Error("signatureKeyId must look like sig-<slug>");
    }
    let seed: Buffer;
    if (parsed.ed25519SeedBase64url) {
      seed = fromBase64Url(parsed.ed25519SeedBase64url);
      if (seed.length !== 32) throw new Error("Ed25519 seeds must be exactly 32 bytes");
    } else {
      const privateKey = crypto.createPrivateKey(parsed.ed25519PrivateKeyPem as string);
      const der = privateKey.export({ format: "der", type: "pkcs8" });
      seed = Buffer.from(der.subarray(der.length - 32));
    }
    const publicRaw = ed25519PublicKeyRaw(ed25519PrivateKeyFromSeed(seed));
    const { secret, protection } = protect(seed);
    upsert(file, {
      keyId: parsed.signatureKeyId,
      kind: "sig",
      createdAt: new Date().toISOString(),
      testOnly: parsed.testOnly === true,
      protection,
      secret,
      publicKeyBase64url: toBase64Url(publicRaw),
    });
  }
  if (!parsed.encryptionKeyId && !parsed.signatureKeyId) {
    throw new Error("key file contains neither encryptionKeyId nor signatureKeyId");
  }
  save(file);
  return listKeys();
}

export function getAesKey(keyId: string): Buffer {
  if (keyId === PACK_KEY_ID) return getPackKey();
  const key = load().keys.find((candidate) => candidate.keyId === keyId && candidate.kind === "enc");
  if (!key) throw new Error(`encryption key "${keyId}" is not available in this operator profile`);
  const raw = unprotect(key);
  if (raw.length !== 32) throw new Error("stored AES key is corrupt");
  return raw;
}

export function getSigningPrivateKey(keyId: string): crypto.KeyObject {
  const key = load().keys.find((candidate) => candidate.keyId === keyId && candidate.kind === "sig");
  if (!key) throw new Error(`signing key "${keyId}" is not available in this operator profile`);
  const seed = unprotect(key);
  if (seed.length !== 32) throw new Error("stored Ed25519 seed is corrupt");
  return ed25519PrivateKeyFromSeed(seed);
}

export function getSigningPublicKey(keyId: string): Buffer | null {
  const key = load().keys.find((candidate) => candidate.keyId === keyId && candidate.kind === "sig");
  if (!key) return null;
  if (key.publicKeyBase64url) return fromBase64Url(key.publicKeyBase64url);
  return ed25519PublicKeyRaw(getSigningPrivateKey(keyId));
}

export function isTestKey(keyId: string): boolean {
  if (keyId === PACK_KEY_ID) return resolvePackKey().source === "test";
  return load().keys.find((candidate) => candidate.keyId === keyId)?.testOnly ?? false;
}

export function keyCount(): { total: number; testOnly: boolean } {
  const keys = load().keys;
  return { total: keys.length, testOnly: keys.length > 0 && keys.every((key) => key.testOnly) };
}

/** Passphrase-encrypted backup (scrypt + AES-256-GCM) for off-machine storage. */
export function backupKeys(passphrase: string, targetPath: string): string {
  if (passphrase.length < 10) throw new Error("backup passphrase must be at least 10 characters");
  const file = load();
  if (file.keys.length === 0) throw new Error("there are no keys to back up yet");
  const plaintext = Buffer.from(JSON.stringify(file), "utf8");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derived = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", derived, iv);
  cipher.setAAD(Buffer.from("REEDANCE-KEY-BACKUP-V1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = {
    format: "reedance-key-backup-v1",
    createdAt: new Date().toISOString(),
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
  writeFileAtomic(targetPath, JSON.stringify(payload, null, 2), 0o600);
  return targetPath;
}

export function encryptionProtectionSummary(): "safeStorage" | "none" {
  return encryptionAvailable() ? "safeStorage" : "none";
}
