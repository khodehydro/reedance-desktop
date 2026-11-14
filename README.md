# Reedance Studio (Windows content app)

Electron desktop application for the Reedance content pipeline. It takes a
**content-only** `*.rddraft.json`, lets the operator choose the audio locally,
syncs every lyric line on a waveform timeline, enforces a human review and the
rights checklist, and finally writes an encrypted, versioned `.rdpack` bundle
together with a signed `latest.json` — exactly as described by
[`WINDOWS_AGENT.md`](https://github.com/khodehydro/reedance/blob/arena/e6a6294d-reedance/docs/architecture/WINDOWS_AGENT.md)
and [`PACKAGE_V1.md`](https://github.com/khodehydro/reedance/blob/arena/e6a6294d-reedance/docs/architecture/PACKAGE_V1.md).

Supported target languages: **en**, **es**, **ko** and **tr**. Turkish is a
studio-side extension over the pinned v1 contract (`contracts/` still lists
`en/es/ko`, and the vendored schemas stay byte-identical — the extension is
applied in memory in `src/main/validation.ts`). Turkish projects are importable
and exportable today and are flagged in the UI so they are only published to an
Android build that accepts `tr`.

The UI is Persian-first with a full English switch, RTL, blue/white, ships
**dark, light and follow-system themes**, and uses
the repository `logo.png` as window icon, sidebar mark, splash logo and
installer icon. The splash screen is signed "HYDRO team".

## Download the installer

| file | size | SHA-256 |
| --- | --- | --- |
| `Reedance-Studio-Setup-1.0.5-x64.exe` | 135,172,551 bytes | `99e72025adbcdbd2feb11444407cbef1b7a82bb6f20ae3840b7f6061d40a99bf` |

The installer sits at the repository root of this workspace. A copy of the same
build is attached to the GitHub release
[`build-5`](https://github.com/khodehydro/reedance-desktop/releases/tag/build-9).
It is unsigned, so Windows SmartScreen asks for **More info → Run anyway**.
See [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) for the Persian walkthrough, the
English summary and the timeline shortcuts.

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
   `Space` play/pause, `J`/`K` line navigation, `A`/`B` loop, zoom, plus a
   **distribute evenly** action for long songs (46 lines in one click, then
   adjust the ones that matter).
4. **Export** — one button. There is a **single file password** (generated on
   first launch, shown in Settings and after every export). The AES-256 key is
   `PBKDF2-HMAC-SHA256(password, "reedance-pack-v1", 200000, 32)`; the plain ZIP
   (`lesson.json` + audio + optional cover) is sealed with AES-256-GCM into
   `v000001-<sha256>.rdpack`, and a signed `latest.json` is written beside it.
   The same password is what the operator enters once in the Android app — it is
   never embedded in the APK. See [`docs/CRYPTO.md`](docs/CRYPTO.md).
5. **Publish** — optional HTTPS verification of a hosted `latest.json`/pack pair
   with size caps, redirect restrictions and signature comparison.

Only the three things that would make the package wrong block an export: no
audio, unmeasured duration, and lyric lines without a (strictly increasing,
in-range) start time — plus schema/semantic errors in the content itself.
Review flags, the rights checklist and a human approval are no longer part of
the flow; the studio never asks for keys either.

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

## The one secret

`Settings → File password` shows the only secret in the product. It is a
20-character human-friendly password, stored in the app profile with restricted
permissions, and it derives the pack key with fixed, documented parameters
(`docs/CRYPTO.md`). Rotating it makes older packs unreadable with the new
password, so only do that on purpose. The fixture **TEST** keys under
`contracts/fixtures/` are still used by the tests; any export that used them is
marked `testOnly` and can never be published.

## Out of scope

No DRM, no subscription logic, no network calls at runtime except the explicit
publish verification, no production host names, no licensed audio.
