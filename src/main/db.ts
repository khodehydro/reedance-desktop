import fs from "node:fs";
import path from "node:path";
import initSqlJs, { Database, SqlValue } from "sql.js";
import { dbFile, ensureDirs, writeFileAtomic } from "./paths";

/**
 * Local SQLite store for the studio (library, versions, stats, audit trail).
 *
 * `sql.js` is used instead of a native module so the packaged app needs no
 * post-install rebuild step; the database is still real SQLite with
 * parameterized SQL, foreign keys, UNIQUE constraints and versioned
 * migrations. The single file is flushed atomically after each transaction.
 */
let db: Database | null = null;
let dirty = false;
let flushTimer: NodeJS.Timeout | null = null;

const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE songs(
    song_id TEXT PRIMARY KEY,
    target_language TEXT NOT NULL CHECK(target_language IN ('en','es','ko','tr')),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE projects(
    project_id TEXT PRIMARY KEY,
    song_id TEXT NOT NULL REFERENCES songs(song_id),
    raw_json_path TEXT NOT NULL,
    raw_sha256 TEXT NOT NULL,
    draft_json TEXT NOT NULL,
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    rights_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT
  );

  CREATE TABLE project_media(
    project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
    audio_copy_path TEXT NOT NULL,
    audio_source_name TEXT NOT NULL,
    audio_sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    extension TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    cover_copy_path TEXT,
    cover_sha256 TEXT,
    cover_mime_type TEXT,
    cover_extension TEXT,
    cover_bytes INTEGER,
    imported_at TEXT NOT NULL
  );

  CREATE TABLE lyric_marks(
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    line_id TEXT NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER,
    reviewed_audio_sha TEXT,
    reviewed_line_sha TEXT,
    PRIMARY KEY(project_id, line_id)
  );

  CREATE TABLE revisions(
    revision_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    song_id TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    snapshot_sha256 TEXT NOT NULL,
    media_sha256 TEXT,
    timeline_sha256 TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    approved_at TEXT,
    approver TEXT,
    rights_checklist_ref TEXT
  );

  CREATE TABLE exports(
    export_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    revision_id TEXT,
    song_id TEXT NOT NULL REFERENCES songs(song_id),
    version_code INTEGER NOT NULL,
    display_version TEXT NOT NULL,
    pack_path TEXT NOT NULL,
    pack_sha256 TEXT NOT NULL,
    pack_size INTEGER NOT NULL,
    manifest_path TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    encryption_key_id TEXT NOT NULL,
    signature_key_id TEXT NOT NULL,
    used_test_keys INTEGER NOT NULL DEFAULT 0,
    exported_at TEXT NOT NULL,
    file_state TEXT NOT NULL DEFAULT 'present',
    UNIQUE(song_id, version_code)
  );

  CREATE TABLE publications(
    export_id TEXT PRIMARY KEY REFERENCES exports(export_id),
    manifest_url TEXT NOT NULL,
    remote_pack_sha256 TEXT NOT NULL,
    remote_manifest_sha256 TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    published_at TEXT NOT NULL
  );

  CREATE TABLE export_lexemes(
    export_id TEXT NOT NULL REFERENCES exports(export_id),
    lexeme_id TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    lemma TEXT NOT NULL,
    target_language TEXT NOT NULL,
    PRIMARY KEY(export_id, lexeme_id)
  );

  CREATE TABLE export_counts(
    export_id TEXT PRIMARY KEY REFERENCES exports(export_id),
    sentence_count INTEGER NOT NULL,
    grammar_count INTEGER NOT NULL,
    lyric_line_count INTEGER NOT NULL,
    idiom_count INTEGER NOT NULL,
    question_count INTEGER NOT NULL,
    vocab_table_count INTEGER NOT NULL
  );

  CREATE TABLE lexeme_registry(
    target_language TEXT NOT NULL,
    lexeme_id TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(target_language, lexeme_id)
  );

  CREATE TABLE audit_events(
    event_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    at TEXT NOT NULL,
    detail TEXT NOT NULL
  );

  CREATE TABLE settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX idx_projects_song ON projects(song_id);
  CREATE INDEX idx_exports_song ON exports(song_id, version_code DESC);
  CREATE INDEX idx_lexemes_lang_key ON export_lexemes(target_language, normalized_key);
  CREATE INDEX idx_audit_entity ON audit_events(entity_id, at DESC);
  `,

  /* v2 — Turkish support (studio extension) on databases created by v1. */
  `
  CREATE TABLE songs_next(
    song_id TEXT PRIMARY KEY,
    target_language TEXT NOT NULL CHECK(target_language IN ('en','es','ko','tr')),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  INSERT INTO songs_next(song_id, target_language, title, artist, created_at)
    SELECT song_id, target_language, title, artist, created_at FROM songs;
  DROP TABLE songs;
  ALTER TABLE songs_next RENAME TO songs;
  `,
];

export async function openDatabase(): Promise<void> {
  ensureDirs();
  const SQL = await initSqlJs({
    // The packaged app keeps the wasm beside the bundle; tests point at the
    // copy inside node_modules with REEDANCE_SQL_WASM_DIR.
    locateFile: (file) => path.join(process.env.REEDANCE_SQL_WASM_DIR ?? __dirname, file),
  });
  const file = dbFile();
  if (fs.existsSync(file)) {
    db = new SQL.Database(fs.readFileSync(file));
  } else {
    db = new SQL.Database();
  }
  db.run("PRAGMA foreign_keys = ON;");
  migrate();
  flushNow();
}

function migrate(): void {
  const database = requireDb();
  const current = (database.exec("PRAGMA user_version;")[0]?.values[0]?.[0] as number) ?? 0;
  // Table rebuilds (the v2 language CHECK) need the parent table to be
  // droppable; `PRAGMA foreign_keys` is a no-op inside a transaction, so it is
  // toggled around the whole migration run and restored afterwards.
  database.exec("PRAGMA foreign_keys = OFF;");
  try {
    for (let version = current; version < MIGRATIONS.length; version += 1) {
      database.exec("BEGIN;");
      try {
        database.exec(MIGRATIONS[version]);
        database.exec(`PRAGMA user_version = ${version + 1};`);
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
    }
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
  if (current < MIGRATIONS.length) {
    database.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", [
      String(MIGRATIONS.length),
    ]);
  }
}

function requireDb(): Database {
  if (!db) throw new Error("database is not open");
  return db;
}

export function markDirty(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      flushNow();
    } catch (error) {
      console.error("failed to flush database", error);
    }
  }, 250);
}

/** Force the in-memory database to disk (called before exports and at quit). */
export function flushNow(): void {
  if (!db) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const bytes = Buffer.from(db.export());
  writeFileAtomic(dbFile(), bytes, 0o600);
  dirty = false;
}

export function closeDatabase(): void {
  if (!db) return;
  flushNow();
  db.close();
  db = null;
}

export function isDirty(): boolean {
  return dirty;
}

type Params = SqlValue[] | Record<string, SqlValue>;

export function all<T = Record<string, unknown>>(sql: string, params: Params = []): T[] {
  const stmt = requireDb().prepare(sql);
  try {
    if (Array.isArray(params)) stmt.bind(params);
    else stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function get<T = Record<string, unknown>>(sql: string, params: Params = []): T | undefined {
  return all<T>(sql, params)[0];
}

export function scalar<T extends SqlValue = SqlValue>(sql: string, params: Params = []): T | undefined {
  const row = get<Record<string, SqlValue>>(sql, params);
  if (!row) return undefined;
  const values = Object.values(row);
  return values[0] as T;
}

export function run(sql: string, params: Params = []): void {
  requireDb().run(sql, params as SqlValue[] | Record<string, SqlValue>);
  markDirty();
}

/** Run `fn` inside a SQLite transaction; flushes to disk on commit. */
export function transaction<T>(fn: () => T): T {
  const database = requireDb();
  database.exec("BEGIN;");
  try {
    const result = fn();
    database.exec("COMMIT;");
    markDirty();
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
}

export function getSetting(key: string): string | undefined {
  return scalar<string>("SELECT value FROM settings WHERE key = ?", [key]) ?? undefined;
}

export function setSetting(key: string, value: string): void {
  run("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    key,
    value,
  ]);
}

export function audit(entityId: string, kind: string, actor: string, detail: unknown): void {
  run("INSERT INTO audit_events(event_id, entity_id, kind, actor, at, detail) VALUES (?, ?, ?, ?, ?, ?)", [
    `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    entityId,
    kind,
    actor,
    new Date().toISOString(),
    typeof detail === "string" ? detail : JSON.stringify(detail),
  ]);
}

export function auditTrail(entityId: string, limit = 100) {
  return all<{ event_id: string; kind: string; actor: string; at: string; detail: string }>(
    "SELECT event_id, kind, actor, at, detail FROM audit_events WHERE entity_id = ? ORDER BY at DESC LIMIT ?",
    [entityId, limit],
  );
}
