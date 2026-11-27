# Card audio and lyric-line language: Studio ↔ Android contract

Status: **implemented in Reedance Studio 1.0.11 and Android 0.1.1 (`versionCode` 2, commits `23d8898`…`e2c511b`)**. Since Studio 1.0.12 the studio also publishes `grammar[].lineIds` (§3.2).
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

Song `lesson.json` is strict v1. Android 0.1.1 added one optional key, `grammar[].lineIds`; every other link uses fields that already existed:

| Card | Linked lines | Notes |
|---|---|---|
| vocabulary word `W` | every line with a token whose `lexemeId == W.lexemeId` | Several lines possible |
| sentence / idiom | `lineId` | Optional field; no ▶ when absent |
| question | `lineId` | Optional field; no ▶ when absent |
| grammar | `lineIds` | Optional; 1–50 distinct lyric ids, none of them a foreign line |

Line times are the published `lyrics[].startMs/endMs`. Never use foreign lines (§1.2); the studio guarantees there are none to find.

**Grammar links (`grammar[].lineIds`).**
- `contracts/lesson.schema.json` is byte-identical to Android `contracts/v1/lesson.schema.json` at `e2c511b`. That file includes `lineIds` and `tr`.
- **Studio 1.0.12 and later publish the field.** `assembleLesson` drops an empty list and writes the ids in lyric order. Export is blocked when an id is unknown or points to a foreign line.
- Android 0.1.1 enforces the same rules in `LessonValidation.kt`.
- ⚠️ Android **0.1.0** rejects a lesson that carries the key. Songs whose grammar cards have no linked line export exactly as before.
- The draft also tolerates `lineIds: []` while editing.

**Playback grouping on Android.** Linked units at consecutive indices form one clip, from the earliest start to the latest end. Units that are not consecutive play separately: a ▶ for the first clip plus up to 8 numbered chips. ReeTalk questions keep the single continuous span. The studio simulator plays one span per card.

---

## 4. Android checklist

All done in Android 0.1.1 (branch `arena/f1399a5c-reedance-android`):

1. ✅ **Lyric badge**: `959bdae`.
2. ✅ **Not taught**: `domain/CardClips.kt` (`teachingVocabulary`, `foreignLyricIds`). Review, the word game, Gym and line learning skip foreign lines.
3. ✅ **ReeTalk cards**: `evidenceTurnIds` on words, grammar and phrases, validated in `ReeTalkInstaller.kt`. Cards show "▶ شنیدن در مکالمه".
4. ✅ **Song cards**: "▶ شنیدن در آهنگ" on word, grammar, idiom, sentence and question cards, including quiz results. Uses a separate foreground player that pauses the main session without seeking it. Locked preview lines never play.
5. ✅ **Docs and minimum turns**: `PACKAGE_V1.md` and `REETALK_PACKAGE_FA.md` updated. The installer now accepts 8–120 turns with ≥4 per speaker, matching the studio.

## 5. Studio side (for reference)

- Validation:
  - Song: `src/main/validation.ts` (`validateContentSemantics`).
  - ReeTalk: `src/main/reetalk.ts` (`cardEvidence`, `publishLearning`).
- Export: `src/main/lesson.ts` (`assembleLesson`) publishes `language` only when it differs from the song language. Since 1.0.12 it also publishes non-empty grammar `lineIds` in lyric order.
- UI:
  - `SegmentAudio.tsx` provides the ▶ player and the line/turn picker.
  - The simulator has a "Cards" page for songs.
- Tests: `tests/line-language.test.ts`, `tests/reetalk.test.ts`, `tests/studio-flow.test.ts`.
