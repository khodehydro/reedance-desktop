# Reedance `.rdpack` Specification — Android App Readme

This document is the complete contract for reading **Reedance Studio `.rdpack` release packs**.
The Android app is the **only** program allowed to read these files. Implement exactly what
this document describes; the reference implementation is the TypeScript code in this
repository (`src/main/crypto/pack.ts`, `src/main/crypto/zip.ts`, `src/main/crypto/sign.ts`,
`src/main/exporter.ts`).

## 1. Embedded key material (embed these exact bytes in the app)

The keys are **fixed distribution material**, not operator secrets. They are embedded in the
Studio binary and must be embedded in the Android app. The operator never sees or manages them.

| Field | Value |
| --- | --- |
| Encryption key id | `enc-main` |
| AES-256 pack key, hex (32 bytes) | `54a096a2fab980c58aae27f6b92e2716ea5c55ad8de1644c37fc4717ed0f2000` |
| AES-256 pack key, base64url | `VKCWovq5gMWKrif2uS4nFupcVa2N4WRMN_xHF-0PIAA` |
| Signing key id | `sig-studio-embedded` |
| Ed25519 signing seed, hex (32 bytes) | `ab3c2e1b621c98e4332415775a66b514970617c33d06d1e94dc5f2dd7e77ae5f` |
| Ed25519 signing seed, base64url | `qzwuG2IcmOQzJBV3Wma1FJcGF8M9BtHpTcXy3X53rl8` |
| Ed25519 raw public key, hex (32 bytes) | `a5ee7bee7a114353c169baf6a50ae3ceb25002418a71632ecf2b012e84ebd4e3` |
| Ed25519 raw public key, base64url | `pe577noRQ1PBabr2pQrjzrJQAkGKcWMuzysBLoTr1OM` |

**Ed25519 key construction (RFC 8410):**

- Private key = PKCS#8 DER: prefix bytes `30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20`
  followed by the 32-byte seed above.
- Public key = the raw 32 bytes listed above. It is exactly the last 32 bytes of the SPKI DER
  of the public key (verified: `der[-32:] === a5ee7bee...`).
- Verify with the raw 32-byte public key; do **not** use a DER/SPKI wrapper unless you strip it
  to the last 32 bytes.

If a pack header carries any key id other than `enc-main`, or the manifest carries any signing
key id other than `sig-studio-embedded`, reject the file with an error — do not attempt to
decrypt.

## 2. `.rdpack` container — `RDPACK1` v1

A pack is a raw byte sequence (not a file extension trick — the file is exactly these bytes):

```
offset 0..8       magic   "RDPACK1\0" (ASCII, 8 bytes)
offset 8          L       uint8, length of the keyId string, 1..32
offset 9..9+L     keyId   ASCII, matches ^enc-[a-z0-9-]+$
offset 9+L..21+L  nonce   12 bytes, fresh CSPRNG per export (never repeated)
offset 21+L..29+L plen    uint64 big-endian, length of the ZIP plaintext (1 .. 256 MiB)
offset 29+L..29+L+plen   AES-256-GCM ciphertext of the ZIP plaintext
offset ...              16-byte GCM tag
```

Decryption (`aes-256-gcm`, key = the 32-byte pack key above, nonce = from the header):

1. Read the header as above; validate the magic, `L`, the `keyId` pattern, and the length
   constraints. The total file size must be exactly `headerLength + plen + 16`.
2. **The header bytes (everything before the ciphertext) are the AAD** — pass them verbatim as
   additional authenticated data. No re-serialization, no padding, no extra fields.
3. Decrypt and verify the GCM tag. Any mismatch (wrong key, tampering, corrupt file) must fail.
4. The result is the ZIP plaintext described in §3.

Constraints: plaintext length `1 .. 268 435 456` (256 MiB); no other versions exist in v1.

## 3. ZIP plaintext inside the pack

The plaintext is a **ZIP archive** with strict rules:

- Flat entry names at the root, ASCII, matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$`.
- Entries only: `STORE` (level 0) or `DEFLATE` level **9** (maximum). Every real entry is
  packed at maximum DEFLATE.
- **No** ZIP64, no data descriptors, no extra fields, no encryption, no duplicate entries.
- **2..4 entries** total, in this exact shape:

| Entry name | Required | Content |
| --- | --- | --- |
| `lesson.json` | always | The lesson document (JSON, UTF-8, ≤ 4 MiB). See §4. |
| `audio.mp3` / `audio.m4a` / `audio.wav` | always | The song audio, exactly the bytes the operator imported (hash-checked at export time). |
| `cover.jpg` / `cover.png` / `cover.webp` | optional | The cover image. |
| `story.mp3` / `story.m4a` / `story.wav` | optional | The story/narration audio. **Some songs have no story** — the entry may be absent. |

Extraction must be memory-safe: enforce a total budget of 252 MiB and per-entry checks; reject
any name containing `/`, `\` or `..`.

## 4. `lesson.json` (schema v1)

The lesson JSON carries `schemaVersion: 1` plus the song content (lyrics, translations, token
glosses, vocabulary, questions, and the `media` block). The `media` block references the
audio by `sha256` and duration:

- `media.audio`: `{ path, mimeType, durationMs, sha256 }` — corresponds to the `audio.*` entry.
- `media.storyAudio` (optional): `{ path, mimeType, durationMs 1..86400000, sha256 }` —
  corresponds to the `story.*` entry. When this key is absent, the song has no story.

If `storyAudio` is present, verify its `sha256` against the extracted `story.*` bytes.

## 5. `latest.json` manifest (signed, sits next to the `.rdpack`)

The Studio writes a sibling `latest.json` per release. The Android app **must** verify the
Ed25519 signature before trusting anything in it.

Envelope shape (exactly three keys):

```json
{
  "signatureKeyId": "sig-studio-embedded",
  "payload": "<base64url, no padding: the UTF-8 JSON payload bytes>",
  "signature": "<base64url, no padding: 64-byte Ed25519 signature>"
}
```

Signature computation — sign over exactly these concatenated bytes:

```
UTF8("REEDANCE-MANIFEST-V1\n")  ||  UTF8(signatureKeyId)  ||  UTF8("\n")  ||  payloadBytes
```

Verify with the raw 32-byte public key from §1. Constraints: payload ≤ 16 KiB, envelope
≤ 32 KiB, signature exactly 64 bytes. Any failure → reject the manifest (and therefore the
release) with an error.

Payload fields the app may consume: `manifestVersion: 1`, `songId`, `targetLanguage`,
`contentVersionCode`, `displayVersion`, `containerVersion: 1`, `lessonSchemaVersion: 1`,
`releasedAt`, and `package: { fileName, sizeBytes, sha256, encryptionKeyId }`. The
`package.sha256` must match the hash of the whole `.rdpack` file bytes.

## 6. File naming

Packs are named `v<versionCode padded to 6 digits>-<sha256 hex of the whole pack bytes>.rdpack`,
e.g. `v000001-93b278b8….rdpack`. Multiple versions of one song may exist side by side;
`latest.json` points at the newest.

## 7. Acceptance checklist (test your implementation against this)

1. Embed the exact key bytes from §1 — a wrong byte must break decryption.
2. Parse and decrypt a real `.rdpack` with the header as AAD; a tampered byte anywhere must
   fail with a GCM error.
3. A pack whose header `keyId` is not `enc-main` is rejected.
4. A manifest whose `signatureKeyId` is not `sig-studio-embedded`, or whose signature does not
   verify against the embedded public key, is rejected.
5. Extract all entries; `lesson.json` validates, `media.audio.sha256` matches the `audio.*`
   entry, and `media.storyAudio.sha256` matches the `story.*` entry **when present**.
6. A song without story audio still opens and shows no story section.

## 8. Reference in this repository

- `src/main/crypto/pack.ts` — container encode/decode (authoritative byte layout).
- `src/main/crypto/zip.ts` — ZIP plaintext rules.
- `src/main/crypto/sign.ts` — Ed25519 manifest signing/verification.
- `src/main/crypto/appkey.ts` — the embedded constants in code.
- `src/main/exporter.ts` — how a pack is produced end to end.
- `tests/handoff.test.ts`, `tests/pack.test.ts`, `tests/story-audio.test.ts` — worked examples
  and fixtures (`contracts/fixtures/*.rdpack`).
- `docs/CRYPTO.md` — the architecture rationale (Persian).
