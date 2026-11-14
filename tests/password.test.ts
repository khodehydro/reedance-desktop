import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decryptPack, encryptPack, sha256Hex } from "../src/main/crypto/pack";
import { buildZip } from "../src/main/crypto/zip";
import {
  PACK_KEY_ID,
  PACK_PASSWORD_ITERATIONS,
  PACK_PASSWORD_SALT,
  derivePackKey,
  ensureStudioKeys,
  generatePackPassword,
  getAesKey,
  getPackPassword,
  setPackPassword,
} from "../src/main/keys";

const repo = path.join(__dirname, "..");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "reedance-password-test-"));
process.env.REEDANCE_STUDIO_ROOT = workspace;
process.env.REEDANCE_SQL_WASM_DIR = path.join(repo, "node_modules", "sql.js", "dist");
process.env.REEDANCE_CONTRACTS_DIR = path.join(repo, "contracts");

const passwordFile = path.join(workspace, "keys", "pack-password.txt");

test("the studio owns exactly one password and reuses it", () => {
  const first = getPackPassword();
  const second = getPackPassword();
  assert.equal(first, second);
  assert.ok(first.length >= 12);
  assert.match(first, /^[abcdefghjkmnpqrstuvwxyz23456789-]+$/);
  assert.equal(fs.readFileSync(passwordFile, "utf8").trim(), first);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(passwordFile).mode & 0o777, 0o600, "only the operator account can read it");
  }
});

test("the AES key is derived from the password with the documented parameters", () => {
  const password = getPackPassword();
  const key = derivePackKey(password);
  assert.equal(key.length, 32);
  assert.deepEqual(derivePackKey(password), key, "derivation is deterministic");
  assert.notDeepEqual(derivePackKey(`${password}-x`), key);

  // The published parameters are what the Android reader must implement.
  assert.equal(PACK_PASSWORD_SALT, "reedance-pack-v1");
  assert.equal(PACK_PASSWORD_ITERATIONS, 200_000);
  assert.equal(PACK_KEY_ID, "enc-main");

  const manual = Buffer.from(
    // independent implementation of PBKDF2-HMAC-SHA256
    require("node:crypto").pbkdf2Sync(password.normalize("NFKC").trim(), "reedance-pack-v1", 200_000, 32, "sha256"),
  );
  assert.deepEqual(manual, key);
});

test("a pack written with the current password opens with it and not with another", () => {
  const password = getPackPassword();
  const zip = buildZip([
    { name: "lesson.json", data: Buffer.from("{\"schemaVersion\":1}"), compress: true },
    { name: "audio.wav", data: Buffer.alloc(2048, 1), compress: false },
  ]);
  const pack = encryptPack(zip, PACK_KEY_ID, derivePackKey(password));
  assert.equal(sha256Hex(decryptPack(pack, getAesKey(PACK_KEY_ID)).plaintext), sha256Hex(zip));

  setPackPassword("a-completely-different-passphrase");
  assert.throws(() => decryptPack(pack, getAesKey(PACK_KEY_ID)), /authenticate|tag/i, "old packs need their old password");
});

test("an operator password must be long enough and is reused by the export path", () => {
  assert.throws(() => setPackPassword("short"), /at least 12/);
  const custom = setPackPassword("  my own studio passphrase  ");
  assert.equal(getPackPassword(), "my own studio passphrase");
  assert.equal(custom, "my own studio passphrase");
  const keys = ensureStudioKeys();
  assert.equal(keys.encryptionKeyId, PACK_KEY_ID);
  assert.match(keys.signatureKeyId, /^sig-studio-/);
  assert.deepEqual(getAesKey(PACK_KEY_ID), derivePackKey("my own studio passphrase"));
});

test("generated passwords are unique and readable", () => {
  const values = new Set(Array.from({ length: 20 }, () => generatePackPassword()));
  assert.equal(values.size, 20);
  for (const value of values) {
    assert.match(value, /^([abcdefghjkmnpqrstuvwxyz23456789]{5}-){3}[abcdefghjkmnpqrstuvwxyz23456789]{5}$/);
  }
});
