import crypto from "node:crypto";

/**
 * `.rdpack` container v1, byte for byte as defined by
 * docs/architecture/PACKAGE_V1.md section 3:
 *
 *   0..8            magic "RDPACK1\0"
 *   8               L (1..32)
 *   9..9+L          keyId (ASCII, ^enc-[a-z0-9-]+$)
 *   9+L..21+L       nonce (12 bytes, CSPRNG, fresh for every export)
 *   21+L..29+L      plaintext ZIP length (uint64 big-endian)
 *   29+L..29+L+P    AES-256-GCM ciphertext
 *   ...             GCM tag (16 bytes)
 *
 * The header (everything before the ciphertext) is the exact AAD; no
 * serialization, padding or extra fields are added anywhere.
 */
export const PACK_MAGIC = Buffer.from("RDPACK1\0", "ascii");
export const PACK_TAG_BYTES = 16;
export const PACK_NONCE_BYTES = 12;
export const PACK_MAX_PLAINTEXT = 256 * 1024 * 1024;

export interface PackHeader {
  keyId: string;
  nonce: Buffer;
  plaintextLength: number;
  headerLength: number;
}

export interface DecodedPack extends PackHeader {
  ciphertext: Buffer;
  tag: Buffer;
  header: Buffer;
}

export function parsePackHeader(file: Buffer): PackHeader {
  if (file.length < PACK_MAGIC.length + 1 + 1 + PACK_NONCE_BYTES + 8 + PACK_TAG_BYTES) {
    throw new Error("pack is truncated");
  }
  if (!file.subarray(0, PACK_MAGIC.length).equals(PACK_MAGIC)) {
    throw new Error("pack magic is not RDPACK1");
  }
  const keyIdLength = file.readUInt8(8);
  if (keyIdLength < 1 || keyIdLength > 32) throw new Error("pack keyId length is invalid");
  if (file.length < 9 + keyIdLength + PACK_NONCE_BYTES + 8 + PACK_TAG_BYTES) {
    throw new Error("pack header is truncated");
  }
  const keyId = file.subarray(9, 9 + keyIdLength).toString("ascii");
  if (!/^enc-[a-z0-9-]+$/.test(keyId)) throw new Error("pack keyId is not a valid encryption key id");
  const nonce = file.subarray(9 + keyIdLength, 9 + keyIdLength + PACK_NONCE_BYTES);
  const plaintextLength = Number(file.readBigUInt64BE(9 + keyIdLength + PACK_NONCE_BYTES));
  if (!Number.isSafeInteger(plaintextLength) || plaintextLength <= 0 || plaintextLength > PACK_MAX_PLAINTEXT) {
    throw new Error("pack plaintext length is out of range");
  }
  const headerLength = 9 + keyIdLength + PACK_NONCE_BYTES + 8;
  return { keyId, nonce: Buffer.from(nonce), plaintextLength, headerLength };
}

export function decodePack(file: Buffer): DecodedPack {
  const header = parsePackHeader(file);
  const expectedLength = header.headerLength + header.plaintextLength + PACK_TAG_BYTES;
  if (file.length !== expectedLength) {
    throw new Error(`pack length mismatch: expected ${expectedLength}, got ${file.length}`);
  }
  return {
    ...header,
    header: file.subarray(0, header.headerLength),
    ciphertext: file.subarray(header.headerLength, header.headerLength + header.plaintextLength),
    tag: file.subarray(header.headerLength + header.plaintextLength),
  };
}

export function encryptPack(zipPlaintext: Buffer, keyId: string, key: Buffer, nonce?: Buffer): Buffer {
  if (!/^enc-[a-z0-9-]+$/.test(keyId) || keyId.length < 5 || keyId.length > 32) {
    throw new Error("encryptionKeyId must match ^enc-[a-z0-9-]+$ and be 5..32 chars");
  }
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32 byte key");
  if (zipPlaintext.length === 0 || zipPlaintext.length > PACK_MAX_PLAINTEXT) {
    throw new Error("ZIP plaintext length is out of range");
  }
  const nonceBytes = nonce ?? crypto.randomBytes(PACK_NONCE_BYTES);
  if (nonceBytes.length !== PACK_NONCE_BYTES) throw new Error("nonce must be 12 bytes");

  const header = Buffer.alloc(9 + keyId.length + PACK_NONCE_BYTES + 8);
  PACK_MAGIC.copy(header, 0);
  header.writeUInt8(keyId.length, 8);
  header.write(keyId, 9, "ascii");
  nonceBytes.copy(header, 9 + keyId.length);
  header.writeBigUInt64BE(BigInt(zipPlaintext.length), 9 + keyId.length + PACK_NONCE_BYTES);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonceBytes, { authTagLength: PACK_TAG_BYTES });
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(zipPlaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([header, ciphertext, tag]);
}

export function decryptPack(file: Buffer, key: Buffer): { plaintext: Buffer; header: Buffer; keyId: string; nonce: Buffer } {
  const decoded = decodePack(file);
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32 byte key");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, decoded.nonce, { authTagLength: PACK_TAG_BYTES });
  decipher.setAAD(decoded.header);
  decipher.setAuthTag(decoded.tag);
  const plaintext = Buffer.concat([decipher.update(decoded.ciphertext), decipher.final()]);
  return { plaintext, header: decoded.header, keyId: decoded.keyId, nonce: decoded.nonce };
}

export function packFileName(versionCode: number, sha256: string): string {
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2147483647) {
    throw new Error("contentVersionCode out of range");
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("sha256 must be lowercase hex");
  return `v${String(versionCode).padStart(6, "0")}-${sha256}.rdpack`;
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Base64URL without padding, minimal encoding, as required by the manifest. */
export function toBase64Url(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("value is not unpadded base64url");
  if (value.length % 4 === 1) throw new Error("value has an invalid base64url length");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}
