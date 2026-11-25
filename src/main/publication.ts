import type { ManifestEnvelope, ManifestPayload, PublicationOutcome } from "../shared/types";
import { audit, flushNow, get, run, scalar } from "./db";
import { getSigningPublicKey } from "./keys";
import { exportRow } from "./projects";
import { nowIso, sha256Hex } from "./util";
import { verifyManifest } from "./crypto/sign";
import { toBase64Url } from "./crypto/pack";

const MAX_PACK_DOWNLOAD = 256 * 1024 * 1024;
const MAX_MANIFEST_DOWNLOAD = 32 * 1024;

function assertHttpsManifestUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("manifest URL is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("manifest URL must use HTTPS");
  if (url.username || url.password) throw new Error("manifest URL must not contain credentials");
  if (url.search || url.hash) throw new Error("manifest URL must not contain a query string or fragment");
  if (!url.pathname.endsWith("/latest.json")) throw new Error("manifest URL must point at .../latest.json");
  return url;
}

/** Fetch while refusing to be redirected to a different origin. */
async function fetchSameOrigin(url: URL, maxBytes: number): Promise<{ bytes: Buffer; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetch(current.toString(), {
      redirect: "manual",
      headers: { "cache-control": "no-cache" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirect without a location (HTTP ${response.status})`);
      const next = new URL(location, current);
      if (next.origin !== url.origin) throw new Error("redirected to a host outside the manifest origin");
      if (next.protocol !== "https:") throw new Error("redirected to a non-HTTPS URL");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`host answered HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > maxBytes) throw new Error("remote file is larger than the allowed limit");
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw new Error("remote file is larger than the allowed limit");
    return { bytes: Buffer.from(arrayBuffer), finalUrl: current.toString() };
  }
  throw new Error("too many redirects");
}

/**
 * Mark a version as published only after the artifacts are re-downloaded from
 * the HTTPS host and verified: signature, song/language/version, pack hash and
 * size. A file merely existing locally is never reported as "published".
 */
export async function publishExport(exportId: string, manifestUrlRaw: string): Promise<PublicationOutcome> {
  const row = exportRow(exportId);
  if (!row) throw new Error("export not found");
  if (row.used_test_keys === 1) throw new Error("exports produced with test-only keys cannot be published");
  const manifestUrl = assertHttpsManifestUrl(manifestUrlRaw);

  const manifest = await fetchSameOrigin(manifestUrl, MAX_MANIFEST_DOWNLOAD);
  const manifestSha = sha256Hex(manifest.bytes);
  let envelope: ManifestEnvelope;
  try {
    envelope = JSON.parse(manifest.bytes.toString("utf8")) as ManifestEnvelope;
  } catch {
    throw new Error("the downloaded latest.json is not valid JSON");
  }
  const publicKey = getSigningPublicKey(row.signature_key_id);
  const verdict = verifyManifest(envelope, publicKey ?? Buffer.alloc(0));
  if (!verdict.ok || !verdict.payload) {
    throw new Error(`remote manifest signature rejected: ${verdict.reason ?? "unknown reason"}`);
  }
  const payload = verdict.payload as ManifestPayload;
  // Song payloads carry songId (v1), ReeTalk payloads dialogueId (v2); the
  // stored row's song_id holds whichever id created the project.
  const remoteId =
    (payload as { manifestVersion?: number }).manifestVersion === 2
      ? (payload as unknown as { dialogueId?: string }).dialogueId
      : payload.songId;
  if (remoteId !== row.song_id) throw new Error("remote manifest is for a different content id");
  if (payload.package.sha256 !== row.pack_sha256) throw new Error("remote manifest points at a different pack hash");
  if (payload.package.sizeBytes !== row.pack_size) throw new Error("remote manifest reports a different pack size");
  if (payload.contentVersionCode !== row.version_code) throw new Error("remote manifest is not this content version");

  const packUrl = new URL(payload.package.fileName, manifestUrl);
  if (packUrl.origin !== manifestUrl.origin) throw new Error("pack URL must live on the manifest origin");
  if (packUrl.search || packUrl.hash) throw new Error("pack URL must be a plain immutable path");
  const pack = await fetchSameOrigin(packUrl, MAX_PACK_DOWNLOAD);
  const remotePackSha = sha256Hex(pack.bytes);
  if (remotePackSha !== payload.package.sha256) throw new Error("downloaded pack hash does not match the signed manifest");
  if (pack.bytes.length !== payload.package.sizeBytes) throw new Error("downloaded pack length does not match the signed manifest");

  const timestamp = nowIso();
  const alreadyPublished = scalar<number>("SELECT COUNT(*) FROM publications WHERE export_id = ?", [exportId]) ?? 0;
  run(
    `INSERT INTO publications(export_id, manifest_url, remote_pack_sha256, remote_manifest_sha256, verified_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(export_id) DO UPDATE SET manifest_url = excluded.manifest_url, remote_pack_sha256 = excluded.remote_pack_sha256,
       remote_manifest_sha256 = excluded.remote_manifest_sha256, verified_at = excluded.verified_at, published_at = excluded.published_at`,
    [exportId, manifestUrl.toString(), remotePackSha, manifestSha, timestamp, timestamp],
  );
  audit(exportId, alreadyPublished ? "publication-reverified" : "published", "operator", {
    manifestUrl: manifestUrl.toString(),
    remotePackSha256: remotePackSha,
  });
  flushNow();
  return {
    exportId,
    manifestUrl: manifestUrl.toString(),
    remotePackSha256: remotePackSha,
    remoteManifestSha256: manifestSha,
    verifiedAt: timestamp,
    publishedAt: timestamp,
  };
}

export function publicationFor(exportId: string) {
  return get<{ manifest_url: string; remote_pack_sha256: string; published_at: string }>(
    "SELECT manifest_url, remote_pack_sha256, published_at FROM publications WHERE export_id = ?",
    [exportId],
  );
}

export function publicKeyFor(signatureKeyId: string): string | null {
  const key = getSigningPublicKey(signatureKeyId);
  return key ? toBase64Url(key) : null;
}
