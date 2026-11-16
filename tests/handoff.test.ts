import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CH } from "../src/shared/ipc";
import { decryptPack, encryptPack, parsePackHeader, sha256Hex } from "../src/main/crypto/pack";
import { buildZip } from "../src/main/crypto/zip";
import {
  PACK_KEY_ID,
  TEST_PACK_KEY_LABEL,
  getAesKey,
  getPackKey,
  isTestKey,
  packKeyInfo,
  parseKeyMaterial,
  testPackKey,
} from "../src/main/keys";

const repo = path.join(__dirname, "..");
const fixtures = path.join(repo, "contracts", "fixtures");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "reedance-handoff-test-"));
process.env.REEDANCE_STUDIO_ROOT = workspace;
process.env.REEDANCE_SQL_WASM_DIR = path.join(repo, "node_modules", "sql.js", "dist");
process.env.REEDANCE_CONTRACTS_DIR = path.join(repo, "contracts");

const keyFile = path.join(workspace, "keys", "enc-main.key");

function zipFixture(): Buffer {
  return buildZip([
    { name: "lesson.json", data: Buffer.from('{"schemaVersion":1}'), compress: true },
    { name: "audio.wav", data: Buffer.alloc(2048, 7), compress: false },
  ]);
}

test("the product has no password surface left", () => {
  const channels = Object.values(CH).join(" ");
  assert.ok(!/password/i.test(channels), `a password channel survived: ${channels}`);
  const keysDir = path.join(workspace, "keys");
  const files = fs.existsSync(keysDir) ? fs.readdirSync(keysDir) : [];
  assert.ok(!files.includes("pack-password.txt"), "the old password file must not be created");
});

test("a fresh install encrypts with the published test key so it works out of the box", () => {
  const key = getPackKey();
  assert.equal(key.length, 32);
  assert.deepEqual(key, testPackKey());
  assert.deepEqual(key, crypto.createHash("sha256").update(TEST_PACK_KEY_LABEL, "utf8").digest());
  assert.equal(PACK_KEY_ID, "enc-main");
  assert.equal(isTestKey(PACK_KEY_ID), true, "the bundled fallback is a test key");
  const info = packKeyInfo();
  assert.equal(info.keyId, "enc-main");
  assert.equal(info.source, "test");
  assert.equal(info.testOnly, true);
  assert.match(info.fingerprint, /^[a-f0-9]{16}$/);
  assert.ok(!fs.existsSync(keyFile), "reading the test key never writes a key file");
});

test("a real key is provisioned from the environment or a key file, with no password", () => {
  const provisioned = crypto.randomBytes(32);
  process.env.REEDANCE_ENC_MAIN_KEY = provisioned.toString("base64url");
  assert.deepEqual(getAesKey(PACK_KEY_ID), provisioned);
  assert.equal(isTestKey(PACK_KEY_ID), false);
  assert.equal(packKeyInfo().source, "env");
  delete process.env.REEDANCE_ENC_MAIN_KEY;

  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, `${provisioned.toString("hex")}\n`, { mode: 0o600 });
  assert.deepEqual(getAesKey(PACK_KEY_ID), provisioned);
  assert.equal(packKeyInfo().source, "file");
  assert.equal(packKeyInfo().testOnly, false);
  if (process.platform !== "win32") assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
});

test("a pack opens with the studio key alone: no secret is ever typed", () => {
  const pack = encryptPack(zipFixture(), PACK_KEY_ID, getAesKey(PACK_KEY_ID));
  const header = parsePackHeader(pack);
  assert.equal(header.keyId, "enc-main");
  assert.equal(header.plaintextLength, zipFixture().length);
  const { plaintext, keyId } = decryptPack(pack, getAesKey(PACK_KEY_ID));
  assert.equal(keyId, "enc-main");
  assert.deepEqual(plaintext, zipFixture());

  const second = encryptPack(zipFixture(), PACK_KEY_ID, getAesKey(PACK_KEY_ID));
  assert.notEqual(parsePackHeader(second).nonce.toString("hex"), header.nonce.toString("hex"), "every export gets a fresh nonce");
});

test("a pack made with another key never opens, and tampering breaks the tag", () => {
  const pack = encryptPack(zipFixture(), PACK_KEY_ID, crypto.randomBytes(32));
  assert.throws(() => decryptPack(pack, getAesKey(PACK_KEY_ID)), /authenticate|unable/i);

  const good = encryptPack(zipFixture(), PACK_KEY_ID, getAesKey(PACK_KEY_ID));
  const tampered = Buffer.from(good);
  tampered[tampered.length - 1] ^= 0x01;
  assert.throws(() => decryptPack(tampered, getAesKey(PACK_KEY_ID)), /authenticate|unable/i);
});

test("an Android-compatible fixture pack decrypts here without any password", () => {
  const fixtureKeys = JSON.parse(fs.readFileSync(path.join(fixtures, "keys.test.json"), "utf8")) as {
    aes256KeyBase64url: string;
    encryptionKeyId: string;
  };
  const packName = fs.readdirSync(fixtures).find((file) => file.endsWith(".rdpack")) as string;
  const pack = fs.readFileSync(path.join(fixtures, packName));
  const key = parseKeyMaterial(fixtureKeys.aes256KeyBase64url);
  assert.ok(key && key.length === 32);
  const { plaintext } = decryptPack(pack, key as Buffer);
  assert.equal(sha256Hex(plaintext).length, 64);
  assert.equal(parsePackHeader(pack).keyId, fixtureKeys.encryptionKeyId);
  assert.ok(packName.startsWith("v000001-"), "pack names carry the version and the hash");
});

test("bad key material and unknown key ids fail loudly", () => {
  assert.equal(parseKeyMaterial("not a key"), null);
  assert.equal(parseKeyMaterial(Buffer.from("abc")), null);
  assert.throws(() => getAesKey("enc-does-not-exist"), /not available/);

  fs.writeFileSync(keyFile, "junk\n", { mode: 0o600 });
  assert.throws(() => getPackKey(), /32-byte key/);
  assert.match(packKeyInfo().error ?? "", /32-byte key/);
  fs.rmSync(keyFile, { force: true });
  assert.deepEqual(getPackKey(), testPackKey(), "removing the provisioned key falls back to test mode");
});
