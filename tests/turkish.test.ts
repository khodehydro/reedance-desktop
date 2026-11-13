import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { DraftContent, RightsChecklist } from "../src/shared/types";
import { decryptPack, sha256Hex } from "../src/main/crypto/pack";
import { readZipStrict } from "../src/main/crypto/zip";
import { closeDatabase, openDatabase } from "../src/main/db";
import { runExport } from "../src/main/exporter";
import { importDraftFile } from "../src/main/import";
import { generateTestKeys, getAesKey } from "../src/main/keys";
import { importAudio } from "../src/main/media";
import {
  approveProject,
  getProjectDetail,
  preflight,
  saveContent,
  saveMarks,
  saveMedia,
  saveRights,
  setReviewed,
} from "../src/main/projects";
import { validateContentSemantics, validateDraftStructure, validateLessonStructure } from "../src/main/validation";

/**
 * Turkish drafts (`targetLanguage: "tr"`) already exist in the content repo
 * while the pinned v1 contract only lists en/es/ko. The studio accepts them as a
 * documented extension and must carry one all the way to a valid `.rdpack`.
 */
const repo = path.join(__dirname, "..");
const fixtures = path.join(repo, "contracts", "fixtures");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "reedance-tr-test-"));

process.env.REEDANCE_STUDIO_ROOT = workspace;
process.env.REEDANCE_SQL_WASM_DIR = path.join(repo, "node_modules", "sql.js", "dist");
process.env.REEDANCE_CONTRACTS_DIR = path.join(repo, "contracts");

function turkishDraft(): DraftContent {
  const base = JSON.parse(fs.readFileSync(path.join(fixtures, "quiet-step.rddraft.json"), "utf8")) as DraftContent;
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") return value.startsWith("en:") ? `tr:${value.slice(3)}` : value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, rewrite(inner)]));
    }
    return value;
  };
  const draft = rewrite(base) as DraftContent;
  draft.songId = "sessiz-adim";
  draft.targetLanguage = "tr";
  draft.locale = "tr-TR";
  draft.title = "Sessiz Adım";
  draft.artist = "Reedance Originals";
  delete draft.level;
  return draft;
}

let projectId = "";

const rights: RightsChecklist = {
  audioRights: true,
  lyricsRights: true,
  coverRights: false,
  offlineDownloadAllowed: true,
  demoAudioDisclosure: true,
  evidenceRef: "demo-licence-2026-01",
  notes: "",
  audioCredit: "Silent fixture audio",
  coverCredit: "",
};

before(async () => {
  await openDatabase();
});

after(() => {
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("a Turkish draft passes the widened contract and imports", () => {
  const draft = turkishDraft();
  assert.deepEqual(validateDraftStructure(draft), []);
  assert.deepEqual(
    validateContentSemantics(draft).filter((issue) => issue.severity === "error"),
    [],
  );

  const file = path.join(workspace, "sessiz-adim.rddraft.json");
  fs.writeFileSync(file, JSON.stringify(draft, null, 2));
  const outcome = importDraftFile(file);
  projectId = outcome.projectId;
  const detail = getProjectDetail(projectId);
  assert.equal(detail.summary.targetLanguage, "tr");
  assert.equal(detail.summary.state, "raw-imported");
  assert.ok(
    detail.warnings.some((issue) => issue.path === "targetLanguage"),
    "Turkish is flagged as an extension over the pinned contract",
  );
  assert.ok(
    detail.issues.some((issue) => issue.path === "level"),
    "a draft without level asks the operator to choose one",
  );
});

test("a Turkish project exports a pack whose lesson.json validates", () => {
  const detail = getProjectDetail(projectId);

  saveContent(projectId, { ...detail.content, level: "A2" });
  const imported = importAudio(projectId, path.join(fixtures, "audio.wav"), null);
  saveMedia(projectId, imported.media, true);
  saveMarks(
    projectId,
    [
      { lineId: "line-1", startMs: 0, endMs: null },
      { lineId: "line-2", startMs: 2000, endMs: null },
    ],
    imported.media,
    detail.content,
  );
  saveRights(projectId, rights);
  setReviewed(projectId, ["line-1", "line-2"], true);
  approveProject(projectId, "QA operator", "Turkish smoke test");
  assert.equal(preflight(projectId).canExport, true);

  const keys = generateTestKeys();
  const encKeyId = keys.find((key) => key.kind === "enc")!.keyId;
  const sigKeyId = keys.find((key) => key.kind === "sig")!.keyId;
  const exported = runExport(
    projectId,
    {
      encryptionKeyId: encKeyId,
      signatureKeyId: sigKeyId,
      displayVersion: "1.0.0",
      manifestBaseUrl: "https://content.example.com/reedance",
      useTestKeys: true,
    },
    { archiveRoot: path.join(workspace, "archive") },
  );

  const pack = fs.readFileSync(exported.packPath);
  assert.equal(sha256Hex(pack), exported.packSha256);
  const { plaintext } = decryptPack(pack, getAesKey(encKeyId));
  const lesson = JSON.parse(readZipStrict(plaintext).files["lesson.json"].toString("utf8"));
  assert.equal(lesson.targetLanguage, "tr");
  assert.equal(lesson.locale, "tr-TR");
  assert.equal(lesson.level, "A2");
  assert.equal(lesson.lyrics[0].startMs, 0);
  assert.ok(lesson.vocabulary.every((word: { lexemeId: string }) => word.lexemeId.startsWith("tr:")));
  assert.deepEqual(validateLessonStructure(lesson), []);
});
