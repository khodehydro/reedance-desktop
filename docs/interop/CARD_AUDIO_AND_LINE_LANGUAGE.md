# Card audio and lyric-line language: Studio ↔ Android contract

Status: **implemented in Reedance Studio 1.0.11**. Android work still to do is in §4.
Audience: the Android agent working on `khodehydro/reedance-android`.

This document covers three things the studio now produces:

1. A lyric line may be sung in another language than the song (`lyrics[].language`). Such a line gets a badge and **is not taught**.
2. In ReeTalk packs, word, grammar and phrase cards may link to the turns they are heard in (`learning.*[].evidenceTurnIds`).
3. A rule that tells every song card and every ReeTalk card which part of the audio it plays.

Nothing here changes the package version, the manifest, the encryption or the file layout.

---

## 1. Song: per-line language (`lesson.json`)

### 1.1 Wire format

This uses the same field as Android commit `959bdae`. `contracts/lesson.schema.json` is byte-identical to Android `contracts/v1/lesson.schema.json`.

```json
{
  "targetLanguage": "es",
  "lyrics": [
    { "id": "line-7", "text": "baby, I love you", "language": "en",
      "startMs": 41200, "endMs": 44100, "translationFa": "…", "translationEn": "…",
      "tokens": [ { "surface": "baby", "translationFa": "عزیزم", "translationEn": "baby" } ] }
  ]
}
```

- `language` is optional, with pattern `^[a-z]{2,3}$`.
- The studio writes it **only when it differs from `targetLanguage`**. A line in the song language never carries the key, so packs without foreign lines are byte-identical to before.
- The key is allowed on both `line` and `untimedLine`.
- The badge rule is unchanged: `alternateLyricLanguage(songLang, lineLang)` returns a value only when both codes are valid and different.

### 1.2 "Not taught": guaranteed by the studio

The studio refuses to export a song where a foreign line is used for teaching. Validation errors block export. For every line `L` with `L.language ≠ targetLanguage`:

| Rule | Studio check |
|---|---|
| No token of `L` has a `lexemeId` | `lyrics[i].tokens[j].lexemeId` → error |
| No `sentences[].lineId == L.id` | error |
| No `idioms[].lineId == L.id` | error |
| No `questions[].lineId == L.id` | error |
| No grammar card is linked to `L` (studio-only, §3.2) | error |

The line itself is kept: its text, sentence translation, token glosses (word-by-word) and timing all ship as usual. The listener still sees and hears it in the lyric player.

**Android can therefore assume the following for every pack the studio produces:**

- A foreign line never contributes words to vocabulary counts, the review deck or word-match questions.
- No card or question points to it.

**Optional hardening for Android (recommended):** when building learning content, skip lines where `alternateLyricLanguage(...) != null`. Concretely: ignore their token `lexemeId`s and do not offer them as "hear it in the song" targets. This protects against hand-made packs.

### 1.3 Compatibility

An older strict reader (before `959bdae`) rejects the unknown `language` key (`additionalProperties:false`). Ship this Android version before publishing songs that contain foreign lines. Songs without foreign lines are unaffected.

---

## 2. ReeTalk: evidence on word / grammar / phrase cards (`dialogue.json`)

```json
"learning": {
  "words":   [ { "id": "word-hello", "text": "hello", "…": "…", "evidenceTurnIds": ["turn-01"] } ],
  "grammar": [ { "id": "gram-present", "…": "…", "evidenceTurnIds": ["turn-02", "turn-03"] } ],
  "phrases": [ { "id": "phrase-how", "…": "…" } ],
  "questions": [ { "id": "q-gist", "…": "…", "evidenceTurnIds": ["turn-01", "turn-04"] } ]
}
```

- Optional on words, grammar and phrases. Questions keep their existing **required, non-empty** `evidenceTurnIds`.
- If present, it is a non-empty array of distinct turn ids that exist in `turns`. The studio never publishes `[]`; an empty list is dropped, so "no evidence" means the key is absent.
- The order of the ids does not matter; playback uses the time span (§3.1).
- The studio rejects unknown or duplicate ids.
- `validateReeTalk` is not key-strict, so current Android builds already install these packs and simply ignore the key.

---

## 3. Which part of the audio a card plays

The same rule applies everywhere, and it matches `ui/DialogueEvidence.kt`: collect the linked units, then play **continuously from the earliest `startMs` to the latest `endMs`**, stopping exactly at that end (ExoPlayer clipping). Units without timing are ignored. If nothing is left, hide or disable the ▶ button.

### 3.1 ReeTalk

| Card | Linked turns |
|---|---|
| question | `evidenceTurnIds` (as today) |
| word | `evidenceTurnIds` |
| grammar | `evidenceTurnIds` |
| phrase | `evidenceTurnIds` |

Turn times are the published `turns[].startMs/endMs`.

### 3.2 Song

Song `lesson.json` stays **strict v1**: no new keys on cards. The links are derived from fields that already exist:

| Card | Linked lines | Notes |
|---|---|---|
| vocabulary word `W` | every line with a token whose `lexemeId == W.lexemeId` | Several lines: either play the span (studio simulator) or offer per-occurrence playback; per-occurrence is recommended for words |
| sentence / idiom | `lineId` | Optional field; no ▶ when absent |
| question | `lineId` | Optional field; no ▶ when absent |
| grammar | — | No line link in `lesson.json` (see below) |

Line times are the published `lyrics[].startMs/endMs`. Never use foreign lines (§1.2); the studio guarantees there are none to find.

**Grammar links are draft-only.** In the studio draft (`.rddraft.json`), `grammar[].lineIds` lets the editor and the simulator play a grammar card. The studio **strips it from `lesson.json`**, because the strict v1 schema would reject it.

If Android later wants grammar playback for songs, the contract change is:

- Add optional `grammar[].lineIds: string[]` to `lesson.schema.json`: `minItems 1`, unique, every id is a lyric id and not a foreign line.
- Update this doc.

The studio then only needs to stop stripping it; the data already exists in the drafts.

---

## 4. Android checklist

1. **Lyric badge**: done in `959bdae`.
2. **Not taught**: optional filter, see §1.2.
3. **ReeTalk cards**:
   - Read optional `evidenceTurnIds` on words, grammar and phrases in `DialogueLearning.kt`.
   - Show "▶ شنیدن در مکالمه" using the existing evidence player.
4. **Song cards**: add "▶ شنیدن در آهنگ" to vocabulary, sentence, idiom and question cards using §3.2.
5. **Docs**: update `docs/reference/PACKAGE_V1.md`, `docs/interop/REETALK_PACKAGE_FA.md` and the minimum-turns note (the studio accepts 8 turns, 4 per speaker).

## 5. Studio side (for reference)

- Validation:
  - Song: `src/main/validation.ts` (`validateContentSemantics`).
  - ReeTalk: `src/main/reetalk.ts` (`cardEvidence`, `publishLearning`).
- Export: `src/main/lesson.ts` (`assembleLesson`) publishes `language` only when it differs from the song language and strips grammar `lineIds`.
- UI:
  - `SegmentAudio.tsx` provides the ▶ player and the line/turn picker.
  - The simulator has a "Cards" page for songs.
- Tests: `tests/line-language.test.ts`, `tests/reetalk.test.ts`, `tests/studio-flow.test.ts`.
