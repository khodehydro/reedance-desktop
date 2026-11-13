import crypto from "node:crypto";
import { fromBase64Url, toBase64Url } from "./pack";
import type { ManifestEnvelope, ManifestPayload } from "../../shared/types";

/**
 * `latest.json` envelope (v1): Ed25519 over
 *   UTF8("REEDANCE-MANIFEST-V1\n") || UTF8(signatureKeyId) || UTF8("\n") || payloadBytes
 * where `payloadBytes` are the original UTF-8 JSON bytes carried in `payload`.
 */
export const MANIFEST_DOMAIN = Buffer.from("REEDANCE-MANIFEST-V1\n", "utf8");
export const MANIFEST_MAX_PAYLOAD = 16 * 1024;
export const MANIFEST_MAX_ENVELOPE = 32 * 1024;

/** PKCS#8 DER prefix for a raw 32-byte Ed25519 seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function ed25519PrivateKeyFromSeed(seed: Buffer): crypto.KeyObject {
  if (seed.length !== 32) throw new Error("Ed25519 seed must be exactly 32 bytes");
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function ed25519SeedFromPrivateKey(privateKeyPem: string): Buffer {
  const key = crypto.createPrivateKey({ key: privateKeyPem });
  const der = key.export({ format: "der", type: "pkcs8" });
  return Buffer.from(der.subarray(der.length - 32));
}

export function ed25519PublicKeyRaw(privateKey: crypto.KeyObject): Buffer {
  const publicKey = crypto.createPublicKey(privateKey);
  const der = publicKey.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32));
}

export function generateSigningKeyPair(): { seed: Buffer; publicRaw: Buffer } {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  const seed = Buffer.from(der.subarray(der.length - 32));
  const key = ed25519PrivateKeyFromSeed(seed);
  return { seed, publicRaw: ed25519PublicKeyRaw(key) };
}

export function signingMessage(signatureKeyId: string, payloadBytes: Buffer): Buffer {
  return Buffer.concat([MANIFEST_DOMAIN, Buffer.from(signatureKeyId, "utf8"), Buffer.from("\n", "utf8"), payloadBytes]);
}

export function signManifest(
  payloadBytes: Buffer,
  signatureKeyId: string,
  privateKey: crypto.KeyObject,
): ManifestEnvelope {
  if (payloadBytes.length === 0 || payloadBytes.length > MANIFEST_MAX_PAYLOAD) {
    throw new Error("manifest payload is out of the 16 KiB contract limit");
  }
  if (!/^sig-[a-z0-9-]+$/.test(signatureKeyId) || signatureKeyId.length < 5 || signatureKeyId.length > 32) {
    throw new Error("signatureKeyId must match ^sig-[a-z0-9-]+$ and be 5..32 chars");
  }
  const signature = crypto.sign(null, signingMessage(signatureKeyId, payloadBytes), privateKey);
  if (signature.length !== 64) throw new Error("Ed25519 signature must be 64 bytes");
  return {
    signatureKeyId,
    payload: toBase64Url(payloadBytes),
    signature: toBase64Url(signature),
  };
}

export function verifyManifest(envelope: ManifestEnvelope, publicKeyRaw: Buffer): { ok: boolean; payloadBytes?: Buffer; payload?: ManifestPayload; reason?: string } {
  try {
    if (!envelope || typeof envelope !== "object") return { ok: false, reason: "envelope is not an object" };
    const keys = Object.keys(envelope).sort().join(",");
    if (keys !== "payload,signature,signatureKeyId") {
      return { ok: false, reason: "envelope must contain exactly signatureKeyId, payload, signature" };
    }
    if (publicKeyRaw.length !== 32) return { ok: false, reason: "pinned public key must be 32 raw bytes" };
    const payloadBytes = fromBase64Url(envelope.payload);
    if (payloadBytes.length > MANIFEST_MAX_PAYLOAD) return { ok: false, reason: "payload exceeds 16 KiB" };
    const signature = fromBase64Url(envelope.signature);
    if (signature.length !== 64) return { ok: false, reason: "signature must be 64 bytes" };

    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyRaw]),
      format: "der",
      type: "spki",
    });
    const ok = crypto.verify(
      null,
      signingMessage(envelope.signatureKeyId, payloadBytes),
      publicKey,
      signature,
    );
    if (!ok) return { ok: false, reason: "Ed25519 signature does not match the payload" };
    const payload = JSON.parse(payloadBytes.toString("utf8")) as ManifestPayload;
    return { ok: true, payloadBytes, payload };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
