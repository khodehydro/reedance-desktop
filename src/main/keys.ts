import crypto from "node:crypto";
import {
  EMBEDDED_PACK_KEY_HEX,
  EMBEDDED_SIGNING_PUBLIC_KEY_HEX,
  EMBEDDED_SIGNING_SEED_HEX,
  PACK_KEY_ID,
  SIGNING_KEY_ID,
  embeddedPackKey,
  embeddedSigningPublicKey,
  embeddedSigningSeed,
} from "./crypto/appkey";

/**
 * Key access for the studio.
 *
 * The pack key and the signing key pair are embedded in the binary (see
 * `crypto/appkey.ts`). The operator has nothing to do and nothing to see:
 * there is no key file, no environment variable, no keystore, no fingerprint
 * and no test-key fallback. Both keys are fixed distribution material shared
 * with the Reedance Android app; `docs/ANDROID_PACK_SPEC.md` carries the
 * exact bytes for the Android side.
 */

export { PACK_KEY_ID, SIGNING_KEY_ID };

/* ------------------------------------------------------------------ */
/* Ed25519 helpers (raw 32-byte keys)                                  */
/* ------------------------------------------------------------------ */

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromBase64Url(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

/** Raw 32-byte Ed25519 public key from a 32-byte seed. */
export function ed25519PublicKeyRaw(seed: Buffer): Buffer {
  const { publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKey: ed25519PrivateKeyFromSeed(seed),
  });
  const der = publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

/** Ed25519 private key object from a raw 32-byte seed. */
export function ed25519PrivateKeyFromSeed(seed: Buffer): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
}

/** Ed25519 key pair for tests and fixture generation. */
export function generateSigningKeyPair(): { seed: Buffer; publicRaw: Buffer } {
  const seed = crypto.randomBytes(32);
  return { seed, publicRaw: ed25519PublicKeyRaw(seed) };
}

/* ------------------------------------------------------------------ */
/* The embedded keys                                                   */
/* ------------------------------------------------------------------ */

/** The AES-256 key used for every pack. Embedded, never operator-visible. */
export function getPackKey(): Buffer {
  return embeddedPackKey();
}

export function getAesKey(keyId: string): Buffer {
  if (keyId !== PACK_KEY_ID) {
    throw new Error(`encryption key "${keyId}" is not the embedded pack key`);
  }
  return getPackKey();
}

export function getSigningPrivateKey(keyId: string): crypto.KeyObject {
  if (keyId !== SIGNING_KEY_ID) {
    throw new Error(`signing key "${keyId}" is not the embedded signing key`);
  }
  return ed25519PrivateKeyFromSeed(embeddedSigningSeed());
}

export function getSigningPublicKey(keyId: string): Buffer | null {
  if (keyId !== SIGNING_KEY_ID) return null;
  return embeddedSigningPublicKey();
}

/** The studio always exports with the embedded keys; nothing to provision. */
export function ensureStudioKeys(): { encryptionKeyId: string; signatureKeyId: string } {
  // Touch the embedded material once so a corrupt constant fails at startup
  // instead of at the first export.
  getPackKey();
  getSigningPrivateKey(SIGNING_KEY_ID);
  return { encryptionKeyId: PACK_KEY_ID, signatureKeyId: SIGNING_KEY_ID };
}

/** Embedded keys are always production keys. */
export function isTestKey(_keyId: string): boolean {
  return false;
}

/** No operator-managed keys exist; the keystore is gone with them. */
export function listKeys(): never[] {
  return [];
}

/** Non-secret description kept for callers that still ask (unused by the UI). */
export function embeddedKeySummary(): { packKeyId: string; signingKeyId: string; packKeyHex: string; signingPublicKeyHex: string } {
  return {
    packKeyId: PACK_KEY_ID,
    signingKeyId: SIGNING_KEY_ID,
    packKeyHex: EMBEDDED_PACK_KEY_HEX,
    signingPublicKeyHex: EMBEDDED_SIGNING_PUBLIC_KEY_HEX,
  };
}

export const _internal = { toBase64Url, fromBase64Url };
