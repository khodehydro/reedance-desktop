#!/usr/bin/env node
/**
 * Regenerate the contract test fixtures.
 *
 * `npm run fixture` writes the scenario drafts into `contracts/fixtures/`:
 *
 *  - `quiet-step.rddraft.json` — the synced-lyric scenario (2 lyric lines that
 *    the operator aligns to the local audio, plus a story section so the
 *    export path also exercises the Android story shape).
 *  - `story-night.rddraft.json` — a second scenario focused on the story
 *    reader: one page, one line, word-by-word glosses on every token.
 *
 * The published `lesson.json` fixture and the encrypted `.rdpack` are pinned
 * artifacts (the manifest signature is checked against the pinned public key)
 * and are deliberately left untouched. The draft → lesson assembly tests
 * (`tests/export-flow.test.ts`, `tests/studio-flow.test.ts`) cover the story
 * shape end to end through the studio pipeline instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "contracts", "fixtures");

const story = {
  title: "The quiet step",
  pages: [
    {
      id: "page-1",
      lines: [
        {
          id: "story-line-1",
          text: "One quiet step starts the night.",
          translationFa: "یک قدم آرام شب را شروع می‌کند.",
          translationEn: "One calm step begins the night.",
          tokens: [
            { surface: "One", translationFa: "یک", translationEn: "one" },
            { surface: "quiet", translationFa: "آرام", translationEn: "calm", lexemeId: "en:quiet" },
            { surface: "step", translationFa: "قدم", translationEn: "step", lexemeId: "en:step" },
            { surface: "starts", translationFa: "شروع می‌کند", translationEn: "begins" },
            { surface: "the", translationFa: "—", translationEn: "the" },
            { surface: "night.", translationFa: "شب.", translationEn: "night" },
          ],
        },
        {
          id: "story-line-2",
          text: "Hope stays alive in the dark.",
          translationFa: "امید در تاریکی زنده می‌ماند.",
          translationEn: "Hope remains alive in the dark.",
          tokens: [
            { surface: "Hope", translationFa: "امید", translationEn: "hope", lexemeId: "en:hope" },
            { surface: "stays", translationFa: "می‌ماند", translationEn: "remains" },
            { surface: "alive", translationFa: "زنده", translationEn: "alive" },
            { surface: "in", translationFa: "در", translationEn: "in" },
            { surface: "the", translationFa: "—", translationEn: "the" },
            { surface: "dark.", translationFa: "تاریکی.", translationEn: "the dark" },
          ],
        },
      ],
    },
  ],
};

const storyNight = {
  title: "Night on the avenue",
  pages: [
    {
      id: "night-page-1",
      lines: [
        {
          id: "night-line-1",
          text: "The street is empty after midnight.",
          translationFa: "بعد از نیمه‌شب خیابان خالی است.",
          translationEn: "The street is empty after midnight.",
          tokens: [
            { surface: "The", translationFa: "—", translationEn: "the" },
            { surface: "street", translationFa: "خیابان", translationEn: "street" },
            { surface: "is", translationFa: "است", translationEn: "is" },
            { surface: "empty", translationFa: "خالی", translationEn: "empty", lexemeId: "en:quiet" },
            { surface: "after", translationFa: "بعد از", translationEn: "after" },
            { surface: "midnight.", translationFa: "نیمه‌شب.", translationEn: "midnight" },
          ],
        },
      ],
    },
  ],
};

function main() {
  const quietStepPath = path.join(fixtures, "quiet-step.rddraft.json");
  const quietStep = JSON.parse(fs.readFileSync(quietStepPath, "utf8"));
  quietStep.story = story;
  fs.writeFileSync(quietStepPath, `${JSON.stringify(quietStep, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(root, quietStepPath)}`);

  const storyNightPath = path.join(fixtures, "story-night.rddraft.json");
  const storyNightDraft = {
    draftSchemaVersion: 1,
    songId: "story-night",
    targetLanguage: "en",
    locale: "en-GB",
    title: "Night on the avenue (test only)",
    artist: "Reedance Contract Tests",
    level: "A1",
    createdAt: "2026-01-01T00:00:00Z",
    generator: "Reedance contract test generator",
    notes: "Story-reader scenario; no audio or timeline markers are in this draft.",
    sources: {
      lyrics: {
        description: "Original invented story text; not sung",
        rightsStatus: "documented",
        sourceReference: "scripts/make-test-fixture.mjs",
        permissionRef: "fixture-only",
      },
      lesson: {
        description: "Original test translations and glosses",
        rightsStatus: "documented",
        sourceReference: "scripts/make-test-fixture.mjs",
        permissionRef: "fixture-only",
      },
    },
    credits: {
      lyrics: "Original test text for this repository",
      noticeFa: "فقط نمونهٔ آزمایشی؛ آهنگ واقعی یا خروجی انتشار نیست.",
      noticeEn: "Test fixture only; not a real song or production release.",
    },
    lyrics: [
      {
        id: "line-1",
        text: "Night falls on the avenue.",
        translationFa: "شب بر خیابان می‌پیچد.",
        translationEn: "Night falls on the avenue.",
        tokens: [
          { surface: "Night", translationFa: "شب", translationEn: "night" },
          { surface: "falls", translationFa: "می‌افتد", translationEn: "falls" },
          { surface: "on", translationFa: "روی", translationEn: "on" },
          { surface: "the", translationFa: "—", translationEn: "the" },
          { surface: "avenue.", translationFa: "خیابان.", translationEn: "avenue" },
        ],
      },
    ],
    story: storyNight,
    vocabulary: [
      {
        lexemeId: "en:quiet",
        lemma: "quiet",
        normalizedKey: "quiet",
        translationFa: "آرام",
        translationEn: "calm",
        ipa: "/ˈkwaɪət/",
        faReading: "کوایِت",
        partFa: "صفت",
        partEn: "adjective",
        tone: "mint",
        example: { text: "A quiet room.", translationFa: "اتاقی آرام.", translationEn: "A calm room." },
      },
    ],
    grammar: [
      {
        id: "night-grammar",
        tagFa: "واژگان",
        tagEn: "Vocabulary",
        titleFa: "صفت آرام",
        titleEn: "The adjective quiet",
        bodyFa: "صفت quiet حالت آرامی را توصیف می‌کند.",
        bodyEn: "The adjective quiet describes a calm state.",
        example: { text: "The night is quiet.", translationFa: "شب آرام است.", translationEn: "The night is calm." },
        tone: "mint",
      },
    ],
    idioms: [],
    sentences: [
      {
        id: "night-sentence",
        text: "The night is quiet.",
        translationFa: "شب آرام است.",
        translationEn: "The night is calm.",
        contextFa: "برای توصیف شب.",
        contextEn: "For describing the night.",
        lineId: "line-1",
      },
    ],
    vocabularyTables: [],
    questions: [
      {
        id: "night-choice",
        type: "choice",
        skillFa: "درک واژه",
        skillEn: "Meaning",
        promptFa: "quiet یعنی چه؟",
        promptEn: "What does quiet mean?",
        explanationFa: "quiet یعنی آرام.",
        explanationEn: "Quiet means calm.",
        lineId: "line-1",
        relatedLexemeIds: ["en:quiet"],
        options: [
          { id: "calm", fa: "آرام", en: "calm" },
          { id: "loud", fa: "بلند", en: "loud" },
        ],
        correctId: "calm",
      },
    ],
  };
  fs.writeFileSync(storyNightPath, `${JSON.stringify(storyNightDraft, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(root, storyNightPath)}`);
}

main();
