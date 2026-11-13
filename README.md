# Reedance Studio (Windows content app)

Electron desktop application for the Reedance content pipeline. It takes a
**content-only** `*.rddraft.json`, lets the operator choose the audio locally,
syncs every lyric line on a waveform timeline, enforces a human review and the
rights checklist, and finally writes an encrypted, versioned `.rdpack` bundle
together with a signed `latest.json` — exactly as described by
[`WINDOWS_AGENT.md`](https://github.com/khodehydro/reedance/blob/arena/e6a6294d-reedance/docs/architecture/WINDOWS_AGENT.md)
and [`PACKAGE_V1.md`](https://github.com/khodehydro/reedance/blob/arena/e6a6294d-reedance/docs/architecture/PACKAGE_V1.md).

The UI is Persian-first with a full English switch, RTL, blue/white, and uses
the repository `logo.png` as window icon, sidebar mark, splash logo and
installer icon. The splash screen is signed "HYDRO team".

## Why the export cannot be wrong by accident

The studio treats the draft as content only. Everything that makes a lesson
playable is produced here:

1. **Import** — the draft is validated against `contracts/draft.schema.json`
   plus semantic rules; any timing, media path or embedded base64 audio is
   rejected outright.
2. **Audio** — the operator picks a file from the OS. It is copied into the
   project folder, hashed (SHA-256), measured (duration, codec, bytes) and
   rendered as a waveform. Replacing it invalidates every mark and the approval.
3. **Timeline** — mark/undo/redo, numeric edit, click-to-seek, `M` capture,
   `Space` play/pause, `J`/`K` line navigation, `A`/`B` loop, zoom.
4. **Review** — per-line human approval plus the rights checklist
   (audio / lyrics / cover / offline download, with an evidence reference).
5. **Export** — blocked until every gate passes. Produces
   `v000001-<sha256>.rdpack` (AES-256-GCM, GCM tag over the exact header as AAD,
   ZIP with `lesson.json` + audio + optional cover) and a signed
   `latest.json` (Ed25519, base64url, `REEDANCE-MANIFEST-V1` message).
   Each written pack is re-opened and re-validated before it is recorded.
6. **Publish** — optional HTTPS verification of a hosted `latest.json`/pack pair
   with size caps, redirect restrictions and signature comparison.

Version codes are reserved monotonically per `songId`; the library keeps every
version, its state (`built`, `verified`, `published`, `failed`), file sizes,
hashes, CSV/JSON statistics and the audit trail.

## Layout

```
contracts/            copy of the v1 JSON Schemas + TEST fixtures (no secrets)
src/shared/           domain types and the IPC channel names
src/main/             Electron main process (SQLite via sql.js, crypto, exports)
src/main/crypto/      pack (AES-GCM), sign (Ed25519), zip (fflate, strict)
src/preload/          contextBridge API — the renderer has no Node access
src/renderer/         React UI (Persian/English, RTL, waveform editor)
tests/                contract, crypto, validation and end-to-end tests
scripts/              build pipeline (vite + esbuild)
build/                icon.ico / icon.png derived from the repository logo
```

## Develop

```bash
npm install
npm run dev          # Vite renderer with an in-memory mock API (browser only)
npm run build        # dist/renderer + dist/main + dist/preload
npm start            # build, then launch Electron
npm run typecheck
npm test             # node --import tsx --test tests/*.test.ts
```

`npm run dev` in a plain browser uses `src/renderer/dev/mock.ts`; the real
filesystem, SQLite database and crypto only exist in Electron.

## Package the Windows installer

```bash
npm run dist:win     # electron-builder --win nsis --x64 → release/
```

The CI workflow `.github/workflows/build-windows.yml` runs the type-check, the
tests and the NSIS build on `windows-latest` for every push and uploads
`Reedance-Studio-Setup-1.0.0-x64.exe` as an artifact. The installer is
unsigned by design: signing needs a certificate that must not be committed.

## Keys

Only the `contracts/fixtures/keys.test.json` **TEST** keys may be used for demo
exports. They are marked `testOnly` and any export that used them can never be
published. Production AES-256 and Ed25519 keys are generated inside the app,
protected with Electron `safeStorage` where available, and exported only as an
encrypted backup with an operator passphrase.

## Out of scope

No DRM, no subscription logic, no network calls at runtime except the explicit
publish verification, no production host names, no licensed audio.
