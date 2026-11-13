import type { DraftContent, Lesson, LyricMark, MediaInfo, RightsChecklist } from "../shared/types";

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
    },
    lyrics: content.lyrics.map((line) => {
      const mark = byLine.get(line.id);
      if (!mark || mark.startMs === null) throw new Error(`line "${line.id}" has no start time`);
      return {
        id: line.id,
        startMs: mark.startMs,
        ...(mark.endMs !== null ? { endMs: mark.endMs } : {}),
        text: line.text,
        translationFa: line.translationFa,
        translationEn: line.translationEn,
        tokens: line.tokens,
      };
    }),
    vocabulary: content.vocabulary,
    grammar: content.grammar,
    idioms: content.idioms,
    sentences: content.sentences,
    vocabularyTables: content.vocabularyTables,
    questions: content.questions,
    ...(content.idAliases?.length ? { idAliases: content.idAliases } : {}),
  };
}
