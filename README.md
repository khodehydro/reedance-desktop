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

Alongside song lessons the studio imports **ReeTalk** dialogues
(`*.reetalkdraft.json`, `contentType: "reetalk"`): a two-speaker conversation
with its learning blocks, timed against the operator's own recorded audio. A
ReeTalk pack is deliberately different — exactly `dialogue.json + audio + cover`
(the cover is mandatory and, like every cover, ships byte-for-byte — never resized or recompressed), a `manifestVersion: 2` payload keyed by `dialogueId`,
and no-overlap timing rules where a recorded turn end is kept as a silence gap
and a missing end falls back to the next turn's start (last turn: the audio
duration). ReeTalk content is fully editable after import (Dialogue & turns,
Learning & questions tabs); the dialogue id, language and speaker ids stay
fixed. A dialogue needs
**8–120 turns with at least 4 per speaker** (lowered from the proposal's 10 / 5
so the authored `reetalk-docs` scenarios — eight turns, four per speaker —
import unchanged; the Android validator must accept the same floor). Draft
files may keep a plain `.json` name.

**Replace JSON** (songs and ReeTalk) swaps in an updated draft for the same
`songId`/`dialogueId` and language, like replacing the audio: media and the
timings of surviving lines are kept, changed lines lose their review, the
approval is cleared and the next export gets a new version code.

**Per-line language** — a lyric line sung in another language carries
`language` (Android `lesson.schema.json`, published only when it differs from
the song language), shows a language badge and is **never taught** (no token
lexemes, no card or question may link to it; enforced by validation).
**Card audio** — every word / grammar / phrase / sentence / question card has a
▶ that plays its linked lines or turns from the earliest start to the latest
end; ReeTalk cards gain optional `evidenceTurnIds`. Contract for Android:
[`docs/interop/CARD_AUDIO_AND_LINE_LANGUAGE.md`](docs/interop/CARD_AUDIO_AND_LINE_LANGUAGE.md).

The UI is Persian-first with a full English switch, RTL, blue/white, ships
**dark, light and follow-system themes**, and uses
the repository `logo.png` as window icon, sidebar mark, splash logo and
installer icon. The splash screen is signed "HYDRO team".

## Download the installer

| file | size | SHA-256 |
| --- | --- | --- |
| `Reedance-Studio-Setup-1.0.10-x64.exe` | 135,208,852 bytes | `170d145cc13f428a3310ae15696fb8f8c2f07cd6a42fd16194dba7c02186ca08` |

The installer sits at the repository root of this workspace. A copy of the same
build is attached to the GitHub release
[`build-26`](https://github.com/khodehydro/reedance-desktop/releases/tag/build-26).
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
3. **Timeline** — CapCut-style clip track: drag each line from the list onto the
   timeline, trim the selected clip with start/end handles or move it (previous
   clips are locked), snapping, deep zoom (0.25 ms/px) with a mini-map;
   mark/undo/redo, numeric edit, click-to-seek, `M` capture of a
   line start and `E` capture of a line end, `Space` play/pause, `J`/`K` line
   navigation, `A`/`B` loop, zoom, plus a **distribute evenly** action for long
   songs (46 lines in one click, then adjust the ones that matter). A line
   exported without a recorded end gets the next line's start (last line: the
   audio duration), so timing only the starts is enough — recorded ends stay
   untouched and are kept as silence gaps.
4. **Export** — one button, no password anywhere. The plain ZIP (`lesson.json`
   + audio + optional cover) is sealed with AES-256-GCM under the fixed
   distribution key `enc-main` into `v000001-<sha256>.rdpack`, and a signed
   `latest.json` is written beside it. The Android app already carries the same
   key, so it opens the file itself — the operator never creates, reads or types
   a secret. See [`docs/CRYPTO.md`](docs/CRYPTO.md).
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

## There is no secret to handle

`Settings → File encryption key` only reports which key seals packs: the key id
(`enc-main`), where it came from and a truncated fingerprint — never key bytes.
Windows reads that key in this order: `REEDANCE_ENC_MAIN_KEY`, then
`…/studio/keys/enc-main.key`, then a key imported with the Settings button, then
the published **TEST** key so a fresh install can export immediately. Test-key
exports are badged in the UI, stored with `used_test_keys = 1` and must not be
published. Provision the real key once (file or button) and every later export
is encrypted with it; nothing is baked into the installer or committed to Git.

Because the key lives in the Windows app and in the Android app, this protects
the ZIP from tampering and casual redistribution — it is not DRM.

## Out of scope

No DRM, no subscription logic, no network calls at runtime except the explicit
publish verification, no production host names, no licensed audio.
