import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type { KeyRecord } from "../shared/types";
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

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function protect(raw: Buffer): { secret: string; protection: StoredKey["protection"] } {
  if (encryptionAvailable()) {
    const encrypted = safeStorage.encryptString(raw.toString("base64"));
    return { secret: encrypted.toString("base64"), protection: "safeStorage" };
  }
  return { secret: raw.toString("base64"), protection: "none" };
}

function unprotect(key: StoredKey): Buffer {
  if (key.protection === "safeStorage") {
    const decoded = safeStorage.decryptString(Buffer.from(key.secret, "base64"));
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
