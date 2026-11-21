import fs from "node:fs";
import path from "node:path";
import type {
  ExportOutcome,
  Lesson,
  ManifestEnvelope,
  ManifestPayload,
  MediaInfo,
  PreflightReport,
} from "../shared/types";
import { audit, flushNow, get, run, scalar, transaction } from "./db";
import { ensureStudioKeys, getAesKey, getSigningPrivateKey, getSigningPublicKey, PACK_KEY_ID, SIGNING_KEY_ID } from "./keys";
import { assertInside, writeFileAtomic } from "./paths";
import { EXPORT_GATES, buildLessonForExport, exportRow, loadProject, preflight, readMedia, readPayload } from "./projects";
import { nowIso, sha256Hex } from "./util";
import { decryptPack, encryptPack, packFileName, parsePackHeader } from "./crypto/pack";
import { signManifest, verifyManifest } from "./crypto/sign";
import { buildZip, readZipStrict, type ZipEntryInput } from "./crypto/zip";
import { normalizeKey, validateLessonSemantics, validateLessonStructure } from "./validation";

const LESSON_MAX_BYTES = 4 * 1024 * 1024;
const PACK_MAX_BYTES = 256 * 1024 * 1024;

export interface ExportOptions {
  encryptionKeyId: string;
  signatureKeyId: string;
  displayVersion: string;
  manifestBaseUrl: string;
}

export interface ExportContext {
  archiveRoot: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function nextFreeVersion(songId: string, songDir: string): number {
  const fromDb = Number(scalar<number>("SELECT COALESCE(MAX(version_code), 0) FROM exports WHERE song_id = ?", [songId]) ?? 0);
  let fromFiles = 0;
  try {
    for (const file of fs.readdirSync(songDir)) {
      const match = /^v(\d{6,10})-[a-f0-9]{64}\.rdpack$/.exec(file);
      if (match) fromFiles = Math.max(fromFiles, Number(match[1]));
    }
  } catch {
    fromFiles = 0;
  }
  const next = Math.max(fromDb, fromFiles) + 1;
  if (next > 2147483647) throw new Error("contentVersionCode limit reached for this song");
  return next;
}

export interface QuickExportInput {
  displayVersion?: string;
  manifestBaseUrl?: string;
}

/**
 * The single button the operator uses.
 *
 * Everything the contract needs is resolved here: the studio keys (created on
 * first use), a version string and an optional manifest base URL. No key picker,
 * no confirmation dialogs.
 */
export function runQuickExport(projectId: string, input: QuickExportInput, context: ExportContext): ExportOutcome {
  const { encryptionKeyId, signatureKeyId } = ensureStudioKeys();
  const requested = (input.displayVersion ?? "").trim();
  return runExport(
    projectId,
    {
      encryptionKeyId,
      signatureKeyId,
      displayVersion: /^\d+\.\d+\.\d+$/.test(requested) ? requested : "1.0.0",
      manifestBaseUrl: (input.manifestBaseUrl ?? "").trim(),
    },
    context,
  );
}

export function songArchiveDir(context: ExportContext, targetLanguage: string, songId: string): string {
  const dir = path.join(context.archiveRoot, targetLanguage, songId);
  ensureDir(dir);
  ensureDir(path.join(dir, "manifests"));
  return assertInside(context.archiveRoot, dir);
}

/**
 * Build `lesson.json`, wrap it into a ZIP with the locally selected audio (and
 * optional cover), encrypt it as `.rdpack`, sign the manifest and record the
 * immutable version. Everything is re-opened and verified before the operator
 * sees a success message.
 */
export function runExport(projectId: string, options: ExportOptions, context: ExportContext): ExportOutcome {
  const report = preflight(projectId);
  if (!report.canExport) {
    // Only the gates that actually block an export are reported; the review and
    // approval gates still exist in the data model but never lock the file.
    const failed = report.gates
      .filter((gate) => !gate.ok && (EXPORT_GATES as readonly string[]).includes(gate.key))
      .map((gate) => `${gate.labelEn}: ${gate.detail}`);
    throw new Error(`export is locked — ${failed.join("; ")}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(options.displayVersion)) {
    throw new Error("displayVersion must look like 1.0.0");
  }
  if (options.manifestBaseUrl && !options.manifestBaseUrl.startsWith("https://")) {
    throw new Error("manifest base URL must be https, or empty when nothing is hosted yet");
  }
  // The pack key is embedded in the binary; a released pack must carry the
  // embedded key id. Any other id can never be opened by the Android app.
  if (options.encryptionKeyId !== PACK_KEY_ID) {
    throw new Error(`packs must use the embedded pack key ${PACK_KEY_ID}`);
  }
  if (options.signatureKeyId !== SIGNING_KEY_ID) {
    throw new Error(`packs must use the embedded signing key ${SIGNING_KEY_ID}`);
  }

  const { lesson, media } = buildLessonForExport(projectId);
  const semantic = validateLessonSemantics(lesson, media.durationMs, media.audioSha256);
  const blocking = semantic.filter((issue) => issue.severity === "error");
  if (blocking.length) {
    throw new Error(`lesson validation failed: ${blocking.map((issue) => `${issue.path} ${issue.message}`).slice(0, 6).join("; ")}`);
  }
  const lessonBytes = Buffer.from(JSON.stringify(lesson, null, 2), "utf8");
  if (lessonBytes.length > LESSON_MAX_BYTES) throw new Error("lesson.json exceeds the 4 MiB contract limit");

  // Media bytes come from the project copy, never from the operator's source path.
  const audioBytes = fs.readFileSync(media.audioPath);
  if (sha256Hex(audioBytes) !== media.audioSha256) {
    throw new Error("the project audio copy changed after import; re-select the audio");
  }
  const entries: ZipEntryInput[] = [
    { name: "lesson.json", data: lessonBytes, compress: true },
    {
      name: `audio.${media.extension}` as "audio.mp3" | "audio.m4a" | "audio.wav",
      data: audioBytes,
      compress: true,
    },
  ];
  if (media.coverPath && media.coverExtension) {
    entries.push({
      name: `cover.${media.coverExtension}` as "cover.jpg" | "cover.png" | "cover.webp",
      data: fs.readFileSync(media.coverPath),
      compress: true,
    });
  }
  if (media.storyAudioPath && media.storyAudioExtension && media.storyAudioSha256) {
    const storyBytes = fs.readFileSync(media.storyAudioPath);
    if (sha256Hex(storyBytes) !== media.storyAudioSha256) {
      throw new Error("the project story audio copy changed after import; re-select the story audio");
    }
    entries.push({
      name: `story.${media.storyAudioExtension}` as "story.mp3" | "story.m4a" | "story.wav",
      data: storyBytes,
      compress: true,
    });
  }
  const zip = buildZip(entries);
  const aesKey = getAesKey(options.encryptionKeyId);
  const pack = encryptPack(zip, options.encryptionKeyId, aesKey);
  if (pack.length > PACK_MAX_BYTES) throw new Error("pack exceeds the 256 MiB contract limit");
  const packSha = sha256Hex(pack);

  // Refuse a lexemeId that already means a different word in this language.
  for (const word of lesson.vocabulary) {
    const existing = get<{ normalized_key: string }>(
      "SELECT normalized_key FROM lexeme_registry WHERE target_language = ? AND lexeme_id = ?",
      [lesson.targetLanguage, word.lexemeId],
    );
    if (existing && existing.normalized_key !== word.normalizedKey) {
      throw new Error(
        `lexemeId "${word.lexemeId}" already points to "${existing.normalized_key}" but this version uses "${word.normalizedKey}"; keep lexeme ids stable`,
      );
    }
  }

  const songDir = songArchiveDir(context, lesson.targetLanguage, lesson.songId);
  const versionCode = nextFreeVersion(lesson.songId, songDir);
  const fileName = packFileName(versionCode, packSha);
  const packPath = path.join(songDir, fileName);
  if (fs.existsSync(packPath)) {
    const existing = fs.readFileSync(packPath);
    if (sha256Hex(existing) !== packSha) throw new Error("an unrelated pack already occupies this version path");
  } else {
    writeFileAtomic(packPath, pack, 0o444);
  }

  const payload: ManifestPayload = {
    manifestVersion: 1,
    songId: lesson.songId,
    targetLanguage: lesson.targetLanguage,
    contentVersionCode: versionCode,
    displayVersion: options.displayVersion,
    containerVersion: 1,
    lessonSchemaVersion: 1,
    releasedAt: nowIso(),
    package: {
      fileName,

      sizeBytes: pack.length,
      sha256: packSha,
      encryptionKeyId: options.encryptionKeyId,
    },
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (payloadBytes.length > 16 * 1024) throw new Error("manifest payload exceeds the 16 KiB contract limit");
  const envelope: ManifestEnvelope = signManifest(payloadBytes, options.signatureKeyId, getSigningPrivateKey(options.signatureKeyId));
  const manifestJson = JSON.stringify(envelope);
  if (manifestJson.length > 32 * 1024) throw new Error("latest.json exceeds the 32 KiB contract limit");

  const manifestCopy = path.join(songDir, "manifests", fileName.replace(/\.rdpack$/, ".json"));
  if (!fs.existsSync(manifestCopy)) writeFileAtomic(manifestCopy, manifestJson, 0o444);
  const latestPath = path.join(songDir, "latest.json");
  writeFileAtomic(latestPath, manifestJson, 0o444);

  // Re-open everything we just produced before recording the version.
  const verification = verifyArtifacts({
    packPath,
    manifestPath: manifestCopy,
    lessonBytes,
    audioSha256: media.audioSha256,
    publicKey: getSigningPublicKey(options.signatureKeyId),
    aesKey,
    expectedSha: packSha,
  });

  const exportId = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const row = loadProject(projectId);
  const revision = get<{ revision_id: string }>(
    "SELECT revision_id FROM revisions WHERE project_id = ? ORDER BY imported_at DESC LIMIT 1",
    [projectId],
  );
  transaction(() => {
    run(
      `INSERT INTO exports(export_id, project_id, revision_id, song_id, version_code, display_version, pack_path, pack_sha256, pack_size,
        manifest_path, manifest_sha256, payload_json, encryption_key_id, signature_key_id, used_test_keys, exported_at, file_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present')`,
      [
        exportId,
        projectId,
        revision?.revision_id ?? null,
        lesson.songId,
        versionCode,
        options.displayVersion,
        packPath,
        packSha,
        pack.length,
        manifestCopy,
        sha256Hex(manifestJson),
        payloadBytes.toString("utf8"),
        options.encryptionKeyId,
        options.signatureKeyId,
        0,
        nowIso(),
      ],
    );
    for (const word of lesson.vocabulary) {
      run(
        `INSERT INTO export_lexemes(export_id, lexeme_id, normalized_key, lemma, target_language)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(export_id, lexeme_id) DO NOTHING`,
        [exportId, word.lexemeId, normalizeKey(word.normalizedKey), word.lemma, lesson.targetLanguage],
      );
      run(
        `INSERT INTO lexeme_registry(target_language, lexeme_id, normalized_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(target_language, lexeme_id) DO UPDATE SET normalized_key = excluded.normalized_key, updated_at = excluded.updated_at`,
        [lesson.targetLanguage, word.lexemeId, normalizeKey(word.normalizedKey), nowIso()],
      );
    }
    run(
      `INSERT INTO export_counts(export_id, sentence_count, grammar_count, lyric_line_count, idiom_count, question_count, vocab_table_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        exportId,
        lesson.sentences.length,
        lesson.grammar.length,
        lesson.lyrics.length,
        lesson.idioms.length,
        lesson.questions.length,
        lesson.vocabularyTables.length,
      ],
    );
    audit(projectId, "exported", "operator", {
      exportId,
      versionCode,
      packSha256: packSha,
      sizeBytes: pack.length,
      encryptionKeyId: options.encryptionKeyId,
      signatureKeyId: options.signatureKeyId,
      usedTestKeys: false,
    });
    void row;
  });
  flushNow();

  return {
    exportId,
    versionCode,
    displayVersion: options.displayVersion,
    packPath,
    packSha256: packSha,
    packSize: pack.length,
    manifestPath: manifestCopy,
    manifestSha256: sha256Hex(manifestJson),
    manifestUrlHint: options.manifestBaseUrl
      ? `${options.manifestBaseUrl.replace(/\/+$/, "")}/${lesson.targetLanguage}/${lesson.songId}/latest.json`
      : "",
    usedTestKeys: false,
    verification: {
      packLength: verification.packLength,
      packSha256: verification.packSha256,
      audioSha256: verification.audioSha256,
      lessonSchemaOk: verification.lessonSchemaOk,
      signatureVerified: verification.signatureVerified,
      zipEntries: verification.zipEntries,
      nonceBase64url: verification.nonceBase64url,
    },
  };
}

interface VerifyInput {
  packPath: string;
  manifestPath: string;
  lessonBytes: Buffer;
  audioSha256: string;
  publicKey: Buffer | null;
  aesKey: Buffer;
  expectedSha: string;
}

export function verifyArtifacts(input: VerifyInput) {
  const detail: string[] = [];
  const packBytes = fs.readFileSync(input.packPath);
  const packSha = sha256Hex(packBytes);
  if (packSha !== input.expectedSha) throw new Error("written pack hash does not match the recorded hash");
  detail.push(`pack sha256 ok (${packBytes.length} bytes)`);
  const header = parsePackHeader(packBytes);
  detail.push(`header ok, keyId ${header.keyId}, nonce ${header.nonce.toString("base64url")}`);

  const { plaintext } = decryptPack(packBytes, input.aesKey);
  detail.push("AES-256-GCM tag verified");
  const zip = readZipStrict(plaintext);
  detail.push(`zip entries: ${zip.entries.map((entry) => `${entry.name} (${entry.size})`).join(", ")}`);
  const lessonFromPack = zip.files["lesson.json"];
  if (!lessonFromPack || !lessonFromPack.equals(input.lessonBytes)) {
    throw new Error("lesson.json inside the pack differs from the reviewed lesson");
  }
  const lesson = JSON.parse(lessonFromPack.toString("utf8")) as Lesson;
  const schemaIssues = validateLessonStructure(lesson);
  if (schemaIssues.length) {
    throw new Error(`packed lesson failed schema validation: ${schemaIssues[0].path} ${schemaIssues[0].message}`);
  }
  const audioName = lesson.media.audio.path;
  const audioBytes = zip.files[audioName];
  if (!audioBytes) throw new Error(`pack is missing ${audioName}`);
  const audioSha = sha256Hex(audioBytes);
  if (audioSha !== input.audioSha256 || audioSha !== lesson.media.audio.sha256) {
    throw new Error("audio hash inside the pack does not match the selected audio");
  }
  detail.push(`audio sha256 ok (${audioSha})`);
  if (lesson.media.cover) {
    const coverBytes = zip.files[lesson.media.cover.path];
    if (!coverBytes) throw new Error("pack is missing the cover referenced by lesson.json");
    if (sha256Hex(coverBytes) !== lesson.media.cover.sha256) throw new Error("cover hash mismatch inside the pack");
    detail.push("cover sha256 ok");
  }
  if (lesson.media.storyAudio) {
    const storyBytes = zip.files[lesson.media.storyAudio.path];
    if (!storyBytes) throw new Error("pack is missing the story audio referenced by lesson.json");
    if (sha256Hex(storyBytes) !== lesson.media.storyAudio.sha256) throw new Error("story audio hash mismatch inside the pack");
    detail.push("story audio sha256 ok");
  }

  const envelope = JSON.parse(fs.readFileSync(input.manifestPath, "utf8")) as ManifestEnvelope;
  const verification = verifyManifest(envelope, input.publicKey ?? Buffer.alloc(0));
  if (!verification.ok) throw new Error(`latest.json signature is invalid: ${verification.reason}`);
  if (verification.payload?.package.sha256 !== packSha) throw new Error("manifest does not point at this pack");
  if (verification.payload?.package.sizeBytes !== packBytes.length) throw new Error("manifest size does not match the pack");
  detail.push("Ed25519 signature verified");
  return {
    packLength: packBytes.length,
    packSha256: packSha,
    audioSha256: audioSha,
    lessonSchemaOk: schemaIssues.length === 0,
    signatureVerified: true,
    zipEntries: zip.entries.map((entry) => entry.name),
    nonceBase64url: header.nonce.toString("base64url"),
    detail,
  };
}

export function verifyExport(exportId: string): { verified: boolean; detail: string[] } {
  const row = exportRow(exportId);
  if (!row) throw new Error("export not found");
  const detail: string[] = [];
  try {
    const packBytes = fs.readFileSync(row.pack_path);
    const sha = sha256Hex(packBytes);
    if (sha !== row.pack_sha256) throw new Error("pack hash differs from the recorded hash");
    detail.push(`pack present, sha256 ${sha.slice(0, 16)}…`);
    const header = parsePackHeader(packBytes);
    detail.push(`header keyId ${header.keyId}, nonce ${header.nonce.toString("base64url")}`);
    const { plaintext } = decryptPack(packBytes, getAesKey(row.encryption_key_id));
    detail.push("AES-256-GCM decrypted and authenticated");
    const zip = readZipStrict(plaintext);
    detail.push(`entries: ${zip.entries.map((entry) => entry.name).join(", ")}`);
    const lesson = JSON.parse(zip.files["lesson.json"].toString("utf8")) as Lesson;
    const issues = validateLessonStructure(lesson);
    const semantics = validateLessonSemantics(lesson, lesson.media.audio.durationMs, lesson.media.audio.sha256);
    if (issues.length || semantics.some((issue) => issue.severity === "error")) {
      throw new Error("packed lesson failed validation");
    }
    detail.push("lesson.json validates against urn:reedance:lesson:v1");
    const payload = readPayload(exportId) as ManifestPayload;
    if (payload.package.sha256 !== sha) throw new Error("manifest payload hash mismatch");
    const publicKey = getSigningPublicKey(row.signature_key_id);
    const envelope = JSON.parse(fs.readFileSync(row.manifest_path, "utf8")) as ManifestEnvelope;
    const verdict = verifyManifest(envelope, publicKey ?? Buffer.alloc(0));
    if (!verdict.ok) throw new Error(`signature invalid: ${verdict.reason}`);
    detail.push("Ed25519 manifest signature verified");
    const media =
      lesson.media.audio.sha256 === sha256Hex(zip.files[lesson.media.audio.path] ?? Buffer.alloc(0))
        ? "audio bytes match lesson.json"
        : "audio mismatch";
    detail.push(media);
    return { verified: true, detail };
  } catch (error) {
    detail.push(error instanceof Error ? error.message : String(error));
    return { verified: false, detail };
  }
}

export function verifyExportReport(exportId: string): PreflightReport & { verified: boolean; detail: string[] } {
  const row = exportRow(exportId);
  if (!row) throw new Error("export not found");
  const report = preflight(row.project_id);
  const verification = verifyExport(exportId);
  return { ...report, verified: verification.verified, detail: verification.detail };
}

export function exportMediaInfo(projectId: string): MediaInfo | null {
  return readMedia(projectId)?.media ?? null;
}
