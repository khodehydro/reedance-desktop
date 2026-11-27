import type {
  DraftContent,
  Lesson,
  LessonStoryGloss,
  LessonStoryLine,
  LyricMark,
  MediaInfo,
  RightsChecklist,
  Token,
} from "../shared/types";

/**
 * Pure conversion from the editable project to the published `lesson.json`.
 *
 * No filesystem or database access happens here, which keeps the most
 * important transformation testable and shared by the exporter and the tests:
 * the content-only draft plus the operator's audio/timings becomes the timed
 * lesson that Android reads from inside the pack.
 */
export function assembleLesson(input: {
  content: DraftContent;
  marks: LyricMark[];
  media: MediaInfo;
  rights: RightsChecklist;
}): Lesson {
  const { content, marks, media, rights } = input;
  const credits = content.credits ?? {};
  const byLine = new Map(marks.map((mark) => [mark.lineId, mark]));

  return {
    schemaVersion: 1,
    songId: content.songId,
    targetLanguage: content.targetLanguage,
    locale: content.locale,
    title: content.title,
    artist: content.artist ?? "",
    level: (content.level ?? "A1") as Lesson["level"],
    ...(content.disclaimerFa ? { disclaimerFa: content.disclaimerFa } : {}),
    ...(content.disclaimerEn ? { disclaimerEn: content.disclaimerEn } : {}),
    credits: {
      audio: rights.audioCredit.trim() || "Audio supplied by the operator",
      lyrics: credits.lyrics?.trim() || rights.evidenceRef || "Lyrics credited by the operator",
      ...(media.coverPath ? { cover: rights.coverCredit.trim() || "Cover supplied by the operator" } : {}),
      noticeFa: credits.noticeFa?.trim() || "این بستهٔ آموزشی با تأیید انسانی منتشر شده است.",
      noticeEn: credits.noticeEn?.trim() || "This lesson package was released after human review.",
    },
    media: {
      audio: {
        path: `audio.${media.extension}` as Lesson["media"]["audio"]["path"],
        mimeType: media.mimeType as Lesson["media"]["audio"]["mimeType"],
        durationMs: Math.round(media.durationMs),
        sha256: media.audioSha256,
      },
      ...(media.coverPath && media.coverSha256 && media.coverMimeType && media.coverExtension
        ? {
            cover: {
              path: `cover.${media.coverExtension}` as NonNullable<Lesson["media"]["cover"]>["path"],
              mimeType: media.coverMimeType as NonNullable<Lesson["media"]["cover"]>["mimeType"],
              sha256: media.coverSha256,
            },
          }
        : {}),
      ...(media.storyAudioPath && media.storyAudioSha256 && media.storyAudioMimeType && media.storyAudioExtension
        ? {
            storyAudio: {
              path: `story.${media.storyAudioExtension}` as NonNullable<Lesson["media"]["storyAudio"]>["path"],
              mimeType: media.storyAudioMimeType as NonNullable<Lesson["media"]["storyAudio"]>["mimeType"],
              durationMs: Math.round(media.storyAudioDurationMs ?? 0),
              sha256: media.storyAudioSha256,
            },
          }
        : {}),
    },
    lyrics: content.lyrics.map((line, index) => {
      const mark = byLine.get(line.id);
      if (!mark || mark.startMs === null) throw new Error(`line "${line.id}" has no start time`);
      // Recorded ends are kept verbatim so real silence between lines stays
      // representable. A missing end is derived at export time: the next
      // line's start, and the audio duration for the last line — never an
      // estimate, just the fallback the operator's own timeline implies.
      const next = content.lyrics[index + 1];
      const nextStart = next ? byLine.get(next.id)?.startMs ?? null : null;
      const endMs = mark.endMs ?? nextStart ?? Math.round(media.durationMs);
      // Only a real alternate language is published (same-as-song = omitted).
      const language = line.language && line.language !== content.targetLanguage ? line.language : undefined;
      return {
        id: line.id,
        ...(language ? { language } : {}),
        startMs: mark.startMs,
        endMs,
        text: line.text,
        translationFa: line.translationFa,
        translationEn: line.translationEn,
        tokens: line.tokens,
      };
    }),
    ...(content.story && content.story.pages.length > 0
      ? {
          story: {
            title: content.story.title.trim(),
            pages: content.story.pages
              .map((page) => ({
                lines: (page.lines ?? [])
                  .filter((line) => line.text.trim().length > 0)
                  .map((line) => storyLineToLessonLine(line)),
              }))
              .filter((page) => page.lines.length > 0),
          },
        }
      : {}),
    vocabulary: content.vocabulary,
    // `lineIds` is a studio-only link (card → song playback), not lesson v1.
    grammar: content.grammar.map(({ lineIds: _lineIds, ...item }) => item),
    idioms: content.idioms,
    sentences: content.sentences,
    vocabularyTables: content.vocabularyTables,
    questions: content.questions,
    ...(content.idAliases?.length ? { idAliases: content.idAliases } : {}),
  };
}

/**
 * Published story lines use the Android contract shape: `meaning` translations
 * are named `meaningFa`/`meaningEn` and the word glosses keep their own
 * two translations, mirroring `contracts/v1/lesson.schema.json#/$defs/storyLine`.
 */
function storyGlossToLessonGloss(token: Token): LessonStoryGloss {
  return {
    text: token.surface,
    meaningFa: token.translationFa,
    meaningEn: token.translationEn,
  };
}

function storyLineToLessonLine(line: {
  text: string;
  translationFa: string;
  translationEn: string;
  tokens?: Token[];
}): LessonStoryLine {
  return {
    text: line.text,
    meaningFa: line.translationFa,
    meaningEn: line.translationEn,
    words: (line.tokens ?? []).map(storyGlossToLessonGloss),
  };
}
