import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { decryptPack, parsePackHeader, sha256Hex } from "../src/main/crypto/pack";
import { readZipStrict } from "../src/main/crypto/zip";
import { verifyManifest } from "../src/main/crypto/sign";
import { fromBase64Url } from "../src/main/crypto/pack";
import { validateDraftStructure, validateLessonStructure, validateLessonSemantics } from "../src/main/validation";
import type { Lesson, ManifestEnvelope } from "../src/shared/types";

const fixtures = path.join(__dirname, "..", "contracts", "fixtures");
const readJson = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));
const readBytes = (name: string): Buffer => fs.readFileSync(path.join(fixtures, name));

const keys = readJson("keys.test.json") as {
  encryptionKeyId: string;
  aes256KeyBase64url: string;
  signatureKeyId: string;
  ed25519PublicKeyBase64url: string;
};

test("the content-only fixture draft passes the draft schema", () => {
  const issues = validateDraftStructure(readJson("quiet-step.rddraft.json"));
  assert.deepEqual(issues, []);
});

test("a draft that smuggles timings or media is rejected by the schema", () => {
  const draft = readJson("quiet-step.rddraft.json") as {
    lyrics: { startMs?: number; media?: unknown }[];
  };
  draft.lyrics[0].startMs = 1000;
  const issues = validateDraftStructure(draft);
  assert.ok(
    issues.some((issue) => issue.path === "$/lyrics/0" && /additional properties/.test(issue.message)),
    "startMs must be rejected as an unknown property",
  );
});

test("the published fixture lesson passes the lesson schema and semantics", () => {
  const lesson = readJson("lesson.json") as Lesson;
  assert.deepEqual(validateLessonStructure(lesson), []);
  const semantic = validateLessonSemantics(lesson, lesson.media.audio.durationMs, lesson.media.audio.sha256);
  assert.deepEqual(semantic.filter((issue) => issue.severity === "error"), []);
});

test("the fixture pack decrypts with the test AES key and contains exactly the lesson and audio", () => {
  const packName = fs
    .readdirSync(fixtures)
    .find((file) => file.endsWith(".rdpack"));
  assert.ok(packName, "fixture pack is present");
  const pack = readBytes(packName as string);
  const header = parsePackHeader(pack);
  assert.equal(header.keyId, keys.encryptionKeyId);
  assert.match(header.keyId, /^enc-[a-z0-9-]+$/);

  const key = fromBase64Url(keys.aes256KeyBase64url);
  const { plaintext } = decryptPack(pack, key);
  const zip = readZipStrict(plaintext);
  const names = zip.entries.map((entry) => entry.name).sort();
  assert.deepEqual(names, ["audio.wav", "lesson.json"]);

  const lesson = JSON.parse(zip.files["lesson.json"].toString("utf8")) as Lesson;
  assert.deepEqual(lesson, readJson("lesson.json"));
  assert.equal(sha256Hex(zip.files["audio.wav"]), lesson.media.audio.sha256);
  assert.equal(sha256Hex(readBytes("audio.wav")), lesson.media.audio.sha256);
});

test("a tampered pack byte is rejected by the GCM tag", () => {
  const packName = fs.readdirSync(fixtures).find((file) => file.endsWith(".rdpack")) as string;
  const pack = Buffer.from(readBytes(packName));
  const header = parsePackHeader(pack);
  pack[header.headerLength + 5] = pack[header.headerLength + 5] ^ 0xff;
  const key = fromBase64Url(keys.aes256KeyBase64url);
  assert.throws(() => decryptPack(pack, key));
});

test("the fixture latest.json verifies with the pinned public key and rejects a modified payload", () => {
  const envelope = readJson("latest.json") as ManifestEnvelope;
  const publicKey = fromBase64Url(keys.ed25519PublicKeyBase64url);
  const verdict = verifyManifest(envelope, publicKey);
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.payload?.songId, "quiet-step");
  assert.equal(verdict.payload?.package.fileName, fs.readdirSync(fixtures).find((file) => file.endsWith(".rdpack")));

  const tampered: ManifestEnvelope = { ...envelope, payload: envelope.payload.slice(0, -2) + (envelope.payload.endsWith("A") ? "B" : "A") + envelope.payload.slice(-1) };
  const rejected = verifyManifest(tampered, publicKey);
  assert.equal(rejected.ok, false);
});

test("a manifest signed for another key id fails verification", () => {
  const envelope = readJson("latest.json") as ManifestEnvelope;
  const publicKey = fromBase64Url(keys.ed25519PublicKeyBase64url);
  const renamed: ManifestEnvelope = { ...envelope, signatureKeyId: "sig-other-v1" };
  assert.equal(verifyManifest(renamed, publicKey).ok, false);
});
