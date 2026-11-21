/**
 * Embedded distribution material for the `.rdpack` format.
 *
 * The studio ships with a fixed AES-256 pack key and a fixed Ed25519 signing
 * key pair baked into the binary. The operator never sees, imports or changes
 * any of it: no key file, no environment variable, no keystore, no
 * fingerprint, no test-key checkbox. The matching material is embedded in the
 * Reedance Android app; `docs/ANDROID_PACK_SPEC.md` carries the exact bytes
 * so the Android side can embed the same ones.
 *
 * These constants are distribution material, not operator secrets: their job
 * is to keep random tools out of the format, not to withstand a determined
 * attacker who already owns one of the two apps.
 */

export const PACK_KEY_ID = "enc-main";
export const SIGNING_KEY_ID = "sig-studio-embedded";

/** 32-byte AES-256 pack key, hex. */
export const EMBEDDED_PACK_KEY_HEX =
  "54a096a2fab980c58aae27f6b92e2716ea5c55ad8de1644c37fc4717ed0f2000";

/** 32-byte Ed25519 signing seed, hex (PKCS#8 prefix + seed is the private key). */
export const EMBEDDED_SIGNING_SEED_HEX =
  "ab3c2e1b621c98e4332415775a66b514970617c33d06d1e94dc5f2dd7e77ae5f";

/** 32-byte raw Ed25519 public key, hex (derived from the signing seed above). */
export const EMBEDDED_SIGNING_PUBLIC_KEY_HEX =
  "a5ee7bee7a114353c169baf6a50ae3ceb25002418a71632ecf2b012e84ebd4e3";

export function embeddedPackKey(): Buffer {
  const key = Buffer.from(EMBEDDED_PACK_KEY_HEX, "hex");
  if (key.length !== 32) throw new Error("embedded pack key is corrupt");
  return key;
}

export function embeddedSigningSeed(): Buffer {
  const seed = Buffer.from(EMBEDDED_SIGNING_SEED_HEX, "hex");
  if (seed.length !== 32) throw new Error("embedded signing seed is corrupt");
  return seed;
}

export function embeddedSigningPublicKey(): Buffer {
  const raw = Buffer.from(EMBEDDED_SIGNING_PUBLIC_KEY_HEX, "hex");
  if (raw.length !== 32) throw new Error("embedded signing public key is corrupt");
  return raw;
}
