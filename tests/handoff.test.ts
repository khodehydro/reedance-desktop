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
  EMBEDDED_PACK_KEY_HEX,
  EMBEDDED_SIGNING_PUBLIC_KEY_HEX,
} from "../src/main/crypto/appkey";
import {
  PACK_KEY_ID,
  SIGNING_KEY_ID,
  getAesKey,
  getPackKey,
  getSigningPublicKey,
  isTestKey,
  listKeys,
} from "../src/main/keys";

const repo = path.join(__dirname, "..");
const fixtures = path.join(repo, "contracts", "fixtures");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "reedance-handoff-test-"));
process.env.REEDANCE_STUDIO_ROOT = workspace;
process.env.REEDANCE_SQL_WASM_DIR = path.join(repo, "node_modules", "sql.js", "dist");
process.env.REEDANCE_CONTRACTS_DIR = path.join(repo, "contracts");

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

test("keys are embedded in the binary and there is no operator surface for them", () => {
  const key = getPackKey();
  assert.equal(key.length, 32);
  assert.equal(key.toString("hex"), EMBEDDED_PACK_KEY_HEX, "the pack key is the embedded constant");
  assert.equal(PACK_KEY_ID, "enc-main");
  assert.equal(SIGNING_KEY_ID, "sig-studio-embedded");
  assert.equal(isTestKey(PACK_KEY_ID), false, "the embedded key is a production key, never a test key");
  assert.deepEqual(listKeys(), [], "no key records are exposed to the renderer");
  assert.deepEqual(
    getSigningPublicKey(SIGNING_KEY_ID),
    Buffer.from(EMBEDDED_SIGNING_PUBLIC_KEY_HEX, "hex"),
    "the signing public key matches the published embedded constant",
  );
  // The keys module must not read or write any key material on disk.
  const keysDir = path.join(workspace, "keys");
  assert.ok(!fs.existsSync(keysDir), "reading the embedded keys never touches a keys directory");
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
  const key = Buffer.from(fixtureKeys.aes256KeyBase64url, "base64url");
  assert.equal(key.length, 32);
  const { plaintext } = decryptPack(pack, key);
  assert.equal(sha256Hex(plaintext).length, 64);
  assert.equal(parsePackHeader(pack).keyId, fixtureKeys.encryptionKeyId);
  assert.ok(packName.startsWith("v000001-"), "pack names carry the version and the hash");
});

test("unknown key ids fail loudly; the embedded key is the only one available", () => {
  assert.throws(() => getAesKey("enc-does-not-exist"), /embedded pack key/);
  assert.equal(getSigningPublicKey("sig-does-not-exist"), null, "an unknown signing key id yields no public key");
  assert.equal(isTestKey("sig-does-not-exist"), false);
});
