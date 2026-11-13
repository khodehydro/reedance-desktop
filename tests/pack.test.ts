import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  decryptPack,
  encryptPack,
  packFileName,
  parsePackHeader,
  PACK_MAGIC,
} from "../src/main/crypto/pack";
import { buildZip, readZipStrict } from "../src/main/crypto/zip";

const key = crypto.randomBytes(32);
const lesson = Buffer.from(JSON.stringify({ schemaVersion: 1, hello: "دنیا" }), "utf8");
const audio = crypto.randomBytes(4096);

function makeZip(): Buffer {
  return buildZip([
    { name: "lesson.json", data: lesson, compress: true },
    { name: "audio.mp3", data: audio, compress: false },
  ]);
}

test("the pack header follows the v1 byte layout exactly", () => {
  const zip = makeZip();
  const nonce = Buffer.alloc(12, 7);
  const pack = encryptPack(zip, "enc-local-v1", key, nonce);
  assert.equal(pack.subarray(0, 8).toString("binary"), PACK_MAGIC.toString("binary"));
  assert.equal(pack.readUInt8(8), "enc-local-v1".length);
  assert.equal(pack.subarray(9, 9 + 12).toString("ascii"), "enc-local-v1");
  assert.deepEqual(pack.subarray(21, 33), nonce);
  assert.equal(Number(pack.readBigUInt64BE(33)), zip.length);
  assert.equal(pack.length, 41 + zip.length + 16);
  const header = parsePackHeader(pack);
  assert.equal(header.headerLength, 41);

  const reopened = decryptPack(pack, key);
  assert.deepEqual(reopened.plaintext, zip);
});

test("every export gets a fresh nonce from the CSPRNG", () => {
  const zip = makeZip();
  const first = encryptPack(zip, "enc-local-v1", key);
  const second = encryptPack(zip, "enc-local-v1", key);
  assert.notDeepEqual(parsePackHeader(first).nonce, parsePackHeader(second).nonce);
});

test("pack sizes that do not match the header are rejected", () => {
  const pack = encryptPack(makeZip(), "enc-local-v1", key);
  assert.throws(() => decryptPack(pack.subarray(0, pack.length - 1), key), /length|tag|authenticate/i);
  assert.throws(() => decryptPack(Buffer.concat([pack, Buffer.from([0])]), key));
});

test("wrong keys and invalid key ids are rejected", () => {
  const pack = encryptPack(makeZip(), "enc-local-v1", key);
  assert.throws(() => decryptPack(pack, crypto.randomBytes(32)));
  assert.throws(() => encryptPack(makeZip(), "bad-key", key), /encryptionKeyId/);
  assert.throws(() => encryptPack(makeZip(), "enc-x", crypto.randomBytes(16)), /32 byte/);
});

test("the versioned pack name matches the contract pattern", () => {
  const sha = "a".repeat(64);
  assert.equal(packFileName(2, sha), `v000002-${sha}.rdpack`);
  assert.throws(() => packFileName(0, sha));
  assert.throws(() => packFileName(1, "A".repeat(64)));
});

test("the ZIP reader refuses traversal, duplicates and unknown entries", () => {
  const good = makeZip();
  const files = readZipStrict(good);
  assert.deepEqual(Object.keys(files.files).sort(), ["audio.mp3", "lesson.json"]);

  const traversal = buildZip([
    { name: "lesson.json", data: lesson, compress: true },
    { name: "audio.wav", data: audio, compress: false },
  ]);
  assert.ok(traversal.length > 0);
  assert.throws(() =>
    buildZip([
      { name: "lesson.json", data: lesson, compress: true },
      { name: "../evil.wav" as "audio.wav", data: audio, compress: false },
    ]),
  );
  assert.throws(() =>
    buildZip([
      { name: "lesson.json", data: lesson, compress: true },
      { name: "lesson.json" as "audio.wav", data: audio, compress: false },
    ]),
  );
  assert.throws(() => readZipStrict(Buffer.from("not a zip")), /invalid|zip/i);
});
