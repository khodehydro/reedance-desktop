# The single pack password (crypto for humans)

There is exactly **one secret** in Reedance Studio: the file password. It is
created automatically, shown in *Settings → File password* and again after every
export. The same string is what you enter once in the Android app.

Everything else — hashing, the container layout, the signature on `latest.json` —
is internal. You never see it, pick it or confirm it.

## What the password does

```
key = PBKDF2-HMAC-SHA256(
         password = NFKC(password).trim(),   // the string shown in the app
         salt     = "reedance-pack-v1",
         rounds   = 200000,
         length   = 32 bytes)
```

The resulting 32-byte key encrypts the `.rdpack` with **AES-256-GCM**. The pack
header keeps the same fixed `keyId` value for every file: `enc-main`.

```
"RDPACK1\0" | u8 keyIdLen | keyId "enc-main" | nonce[12] | u64 plaintextLen |
ciphertext | tag[16]        (the whole header is the GCM additional data)
```

Inside the encrypted payload is a plain ZIP: `lesson.json`, the audio file and,
when present, `cover.jpg/png/webp`.

## Android side

1. Ask the operator for the password once (a text field, or a QR shown next to
   the export).
2. Derive the key with the parameters above (e.g. with
   `javax.crypto.SecretKeyFactory` `PBKDF2WithHmacSHA256`, 200 000 iterations,
   256 bits).
3. Parse the header, take `keyId`, `nonce` and the length, then decrypt with
   `AES/GCM/NoPadding` using the header bytes as AAD and the trailing 16 bytes as
   the tag.
4. Unzip in memory and read `lesson.json`; verify the audio SHA-256 from
   `lesson.json.media.audio.sha256` if you want an extra integrity check.

## Why the password is not inside the APK

Any value compiled into an APK (string constant, `BuildConfig` field, asset file,
native library) can be recovered by reverse engineering — that is true of every
scheme, no matter how it is obfuscated. So:

- **Do not** hard-code the password in the Android project.
- Ask the user for it once and store it with the platform keystore
  (`EncryptedSharedPreferences` with an Android Keystore master key, or the
  equivalent). The key material then lives in hardware-backed storage and cannot
  be lifted from the APK.
- Rotate the password if it leaks: *Settings → Generate a new one*. Packs made
  with the old password stay readable with the old password only.

On Windows the password lives in the app's local profile
(`…/studio/keys/pack-password.txt`, readable only by your Windows account). It is
never placed in an installer, a repository file, a log, or the pack header.

## What is still computed (and why you can ignore it)

| Step | Why it exists | Who sees it |
| --- | --- | --- |
| SHA-256 of audio, pack and manifest | detects corruption and version drift | nobody; shown only as a short hash in the library |
| Ed25519 signature over `latest.json` | lets an app reject a tampered update manifest | nobody; verify in the app or ignore for local files |
| AES-256-GCM tag | makes a modified pack fail instead of playing garbage | one error message if the password is wrong |
