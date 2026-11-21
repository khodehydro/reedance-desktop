import React, { useState } from "react";
import type { DraftContent, MediaInfo, Token } from "@shared/types";
import { api } from "../api";
import { useLang } from "../i18n";
import { AudioTimeline } from "./AudioTimeline";
import { Badge, Button, Callout, Field, Mono, Section, Select, TextArea, TextInput, useToast } from "./ui";
import type { UpdateContent } from "./ProjectPage";

function nextLineId(prefix: string, taken: string[]): string {
  let max = 0;
  for (const id of taken) {
    const match = /^[a-z]+-(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${max + 1}`;
}

/**
 * Story editor — the second, narrated text that ships with every song.
 *
 * Mirrors the lyric editor one-for-one: every story line carries its own text,
 * both translations and word-by-word tokens, so Android can render the story
 * reader. On top of that every line and every page has a voice button that
 * speaks the text with the OS voice, so the narration can be checked while
 * authoring. Story lines have no timing: they are never synced to the audio.
 */
export function StoryTab({
  projectId,
  content,
  update,
  media,
  onChanged,
}: {
  projectId: string;
  content: DraftContent;
  update: UpdateContent;
  media: MediaInfo | null;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const { t } = useLang();
  const toast = useToast();
  const story = content.story ?? { title: "", pages: [] };
  const [openPages, setOpenPages] = useState<string | null>(story.pages[0]?.id ?? null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [storyBusy, setStoryBusy] = useState(false);

  const storyAudio = media?.storyAudioFileName
    ? {
        fileName: media.storyAudioFileName,
        durationMs: media.storyAudioDurationMs ?? 0,
        bytes: media.storyAudioBytes ?? 0,
        mimeType: media.storyAudioMimeType ?? "",
      }
    : null;

  const selectStoryAudio = async (): Promise<void> => {
    setStoryBusy(true);
    try {
      const outcome = await api.media.selectStoryAudio(projectId);
      if (outcome === null) return;
      await onChanged();
      toast.push(
        t(
          `صدای داستان انتخاب شد: ${outcome.media.storyAudioFileName}`,
          `Story audio selected: ${outcome.media.storyAudioFileName}`,
        ),
        "ok",
      );
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setStoryBusy(false);
    }
  };

  const removeStoryAudio = async (): Promise<void> => {
    if (!window.confirm(t("صدای داستان از پروژه حذف شود؟", "Remove the story audio from the project?"))) return;
    setStoryBusy(true);
    try {
      await api.media.removeStoryAudio(projectId);
      await onChanged();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setStoryBusy(false);
    }
  };

  const lexemes = content.vocabulary.map((word) => ({ value: word.lexemeId, label: `${word.lemma} (${word.lexemeId})` }));

  const ensureStory = (draft: DraftContent): NonNullable<DraftContent["story"]> => {
    if (!draft.story) draft.story = { title: "", pages: [] };
    return draft.story;
  };

  const addPage = (): void => {
    update((draft) => {
      const next = ensureStory(draft);
      const id = nextPageId(next);
      next.pages.push({ id, lines: [{ id: `${id}-line-1`, text: "", translationFa: "", translationEn: "", tokens: [] }] });
    });
    const added = (content.story?.pages.length ?? 0) + 1;
    setOpenPages(`page-${added}`);
  };

  const removePage = (pageId: string): void => {
    if (story.pages.length <= 1) {
      toast.push(t("حداقل یک صفحه لازم است.", "At least one page is required."), "warn");
      return;
    }
    if (!window.confirm(t(`صفحه «${pageId}» و سطوح آن حذف شوند؟`, `Delete page "${pageId}" and its lines?`))) return;
    update((draft) => {
      const next = ensureStory(draft);
      next.pages = next.pages.filter((page) => page.id !== pageId);
    });
  };

  const movePage = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= story.pages.length) return;
    update((draft) => {
      const next = ensureStory(draft);
      const [page] = next.pages.splice(index, 1);
      next.pages.splice(target, 0, page);
    });
  };

  const addLine = (pageId: string): void => {
    update((draft) => {
      const next = ensureStory(draft);
      const page = next.pages.find((candidate) => candidate.id === pageId);
      if (!page) return;
      page.lines.push({ id: nextLineId(`${pageId}-line`, page.lines.map((line) => line.id)), text: "", translationFa: "", translationEn: "", tokens: [] });
    });
    setOpenPages(pageId);
  };

  const splitIntoTokens = (pageId: string, lineIndex: number): void => {
    const page = story.pages.find((candidate) => candidate.id === pageId);
    const line = page?.lines[lineIndex];
    if (!line || !line.text.trim()) return;
    const pieces = line.text.split(/\s+/).filter(Boolean);
    if (!pieces.length) return;
    update((draft) => {
      const next = ensureStory(draft);
      const target = next.pages.find((candidate) => candidate.id === pageId)?.lines[lineIndex];
      if (target) target.tokens = pieces.map((surface) => ({ surface, translationFa: "", translationEn: "" }));
    });
  };

  const speak = async (key: string, text: string): Promise<void> => {
    const clean = text.trim();
    if (!clean) {
      toast.push(t("متن برایخواندن ناموجود است.", "Nothing to speak: the text is empty."), "warn");
      return;
    }
    setSpeaking(key);
    try {
      const ok = await api.media.speak({ text: clean, lang: content.locale });
      if (!ok) toast.push(t("صدای سیستم نام دسترس است.", "The system voice is unavailable."), "warn");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      setSpeaking(null);
    }
  };

  const storyLineIds = story.pages.flatMap((page) => page.lines.map((line) => line.id));

  return (
    <div className="tab-body">
      <Section
        title={t("داستان آهنگ", "Song story")}
        description={t(
          "هر آهنگ می‌تواند بخش داستان داشته باشد: صفحات متن داستان، ترجمه هر سطر، ترجمه کلمه‌به‌کلمه و یک فایل صوت داستان (mp3، m4a یا wav) که خودتان به پروژه اضافه می‌کنید، مثل صوت آهنگ. داستان زمان‌بندی ندارد و با آهنگ سینک نمی‌شود.",
          "Every song can carry a story section: story pages, a translation per line, word-by-word glosses and a story narration audio file (mp3, m4a or wav) that you add to the project, just like the song audio. Story lines are never timed or synced to the audio.",
        )}
        actions={
          <Button size="sm" variant="primary" onClick={addPage}>
            {t("افزودن صفحه داستان", "Add story page")}
          </Button>
        }
      >
        <div className="form-grid">
          <Field label={t("نام داستان", "Story title")} wide>
            <TextInput
              value={story.title}
              dir="auto"
              onChange={(value) =>
                update((draft) => {
                  ensureStory(draft).title = value;
                })
              }
            />
          </Field>
        </div>

        <div className="story-audio-box">
          <div className="row between gap-sm">
            <div>
              <strong>{t("صدای متن داستان", "Story narration audio")}</strong>
              <p className="tiny">
                {t(
                  "فایل صوتی (mp3، m4a یا wav) که خودتان انتخاب می‌کنید؛ در خروجی به صورت story.<نوع> و در lesson.json به همراه شناسه آن فشرده می‌شود. زیر این باکس همین تایم‌لاین (پخش، سینک، زوم، خط عموی جابه‌جا‌پذیر) برای راست‌چین کردن روایت در دسترس است.",
                  "An audio file (mp3, m4a or wav) you choose yourself; it ships in the pack as story.<ext> and is referenced from lesson.json with its hash. The same timeline (play, seek, zoom, draggable capture line) sits right below for checking the narration.",
                )}
              </p>
            </div>
            <div className="row gap-sm">
              <Button size="sm" variant="ghost" onClick={() => void removeStoryAudio()} disabled={!storyAudio || storyBusy}>
                {t("حذف صوت", "Remove audio")}
              </Button>
              <Button size="sm" variant="primary" onClick={() => void selectStoryAudio()} disabled={storyBusy}>
                {storyAudio ? t("انتخاب صوت دیگر", "Choose another audio") : t("افزودن صوت داستان", "Add story audio")}
              </Button>
            </div>
          </div>
          {storyAudio ? (
            <div className="row gap-sm">
              <Badge tone="info">{storyAudio.fileName}</Badge>
              <Badge tone="muted">
                {t(
                  `${Math.round(storyAudio.durationMs / 1000)} ثانیه · ${(storyAudio.bytes / (1024 * 1024)).toFixed(2)} مگابایت`,
                  `${Math.round(storyAudio.durationMs / 1000)} s · ${(storyAudio.bytes / (1024 * 1024)).toFixed(2)} MiB`,
                )}
              </Badge>
              <Mono>{storyAudio.mimeType}</Mono>
            </div>
          ) : (
            <p className="tiny">{t("هنوز صوت داستانی برای این آهنگ اضافه نشده.", "No story audio has been added to this song yet.")}</p>
          )}
        </div>

        {storyAudio ? (
          <AudioTimeline
            projectId={projectId}
            kind="story-audio"
            durationMs={storyAudio.durationMs}
            shortcuts
            compact
          />
        ) : null}

        {story.pages.length === 0 ? (
          <Callout tone="warn" title={t("هنوز داستان نداری", "No story yet")}>
            {t("یک صفحه داستان اضافه کنید و سطوحش را مثل لیریک‌ها بنویسید.", "Add a story page and write its lines like the lyrics.")}
          </Callout>
        ) : (
          <div className="line-editor-list">
            {story.pages.map((page, pageIndex) => {
              const open = openPages === page.id;
              return (
                <article key={page.id} className="line-editor">
                  <header>
                    <div className="row gap-sm">
                      <Badge tone="muted">{t("صفحه", "page")} {pageIndex + 1}</Badge>
                      <Mono>{page.id}</Mono>
                      <Badge tone={page.lines.some((line) => line.text) ? "info" : "warn"}>
                        {page.lines.length} {t("سطر", "lines")}
                      </Badge>
                    </div>
                    <div className="row gap-sm">
                      <Button size="sm" variant="ghost" onClick={() => movePage(pageIndex, -1)} title="move up">
                        ↑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => movePage(pageIndex, 1)} title="move down">
                        ↓
                      </Button>
                      <Button
                        size="sm"
                        variant={speaking === page.id ? "primary" : "ghost"}
                        disabled={speaking === page.id}
                        onClick={() =>
                          void speak(
                            page.id,
                            page.lines.map((line) => line.text).join(" "),
                          )
                        }
                      >
                        {speaking === page.id ? t("در حال خواندن…", "reading…") : t("صدای صفحه", "Speak page")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setOpenPages(open ? null : page.id)}>
                        {open ? t("بستن", "Close") : t("سطور", "Lines")}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => removePage(page.id)}>
                        {t("حذف صفحه", "Delete page")}
                      </Button>
                    </div>
                  </header>

                  {open ? (
                    <div className="token-editor">
                      {page.lines.map((line, lineIndex) => (
                        <div key={line.id} className="story-line-block">
                          <div className="row between">
                            <Badge tone="muted">{lineIndex + 1}</Badge>
                            <Button
                              size="sm"
                              variant={speaking === `${page.id}/${lineIndex}` ? "primary" : "ghost"}
                              disabled={speaking === `${page.id}/${lineIndex}`}
                              onClick={() => void speak(`${page.id}/${lineIndex}`, line.text)}
                            >
                              {speaking === `${page.id}/${lineIndex}`
                                ? t("در حال خواندن…", "reading…")
                                : t("صدای این سطر", "Speak line")}
                            </Button>
                          </div>
                          <div className="form-grid">
                            <Field label={t("متن سطر داستان", "story line text")} wide>
                              <TextInput
                                value={line.text}
                                dir="ltr"
                                onChange={(value) =>
                                  update((draft) => {
                                    const target = ensureStory(draft).pages.find((candidate) => candidate.id === page.id)?.lines[lineIndex];
                                    if (target) target.text = value;
                                  })
                                }
                              />
                            </Field>
                            <Field label={t("ترجمهٔ فارسی", "translation (FA)")}>
                              <TextArea
                                value={line.translationFa}
                                rows={2}
                                dir="rtl"
                                onChange={(value) =>
                                  update((draft) => {
                                    const target = ensureStory(draft).pages.find((candidate) => candidate.id === page.id)?.lines[lineIndex];
                                    if (target) target.translationFa = value;
                                  })
                                }
                              />
                            </Field>
                            <Field label={t("ترجمهٔ انگلیسی", "translation (EN)")}>
                              <TextArea
                                value={line.translationEn}
                                rows={2}
                                dir="ltr"
                                onChange={(value) =>
                                  update((draft) => {
                                    const target = ensureStory(draft).pages.find((candidate) => candidate.id === page.id)?.lines[lineIndex];
                                    if (target) target.translationEn = value;
                                  })
                                }
                              />
                            </Field>
                          </div>

                          <div className="token-editor">
                            <div className="row between">
                              <strong>{t("توکن‌های واژه‌به‌واژه", "Word-by-word tokens")}</strong>
                              <div className="row gap-sm">
                                <Button size="sm" variant="ghost" onClick={() => splitIntoTokens(page.id, lineIndex)}>
                                  {t("ساخت خودکار از متن", "Rebuild from text")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    update((draft) => {
                                      const target = ensureStory(draft).pages.find((candidate) => candidate.id === page.id)?.lines[lineIndex];
                                      target?.tokens.push({ surface: "", translationFa: "", translationEn: "" });
                                    })
                                  }
                                >
                                  {t("افزودن توکن", "Add token")}
                                </Button>
                              </div>
                            </div>
                            {line.tokens.length === 0 ? (
                              <p className="tiny">{t("برای ترجمه کلمه‌به‌کلمه، توکن‌ها را از متن ساخت»، یا هر کلمه را جداگانه بنویسید.", "To translate word by word, build the tokens from the text, or write each word separately.")}</p>
                            ) : (
                              <div className="token-rows">
                                {line.tokens.map((token, tokenIndex) => (
                                  <TokenRow
                                    key={`${line.id}-${tokenIndex}`}
                                    token={token}
                                    lexemes={lexemes}
                                    onChange={(patch) =>
                                      update((draft) => {
                                        const target = ensureStory(draft).pages.find((candidate) => candidate.id === page.id)?.lines[lineIndex]?.tokens[tokenIndex];
                                        if (target) Object.assign(target, patch);
                                      })
                                    }
                                    onRemove={() =>
                                      update((draft) => {
                                        const lines = ensureStory(draft).pages.find((candidate) => candidate.id === page.id)?.lines[lineIndex]?.tokens;
                                        lines?.splice(tokenIndex, 1);
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" onClick={() => addLine(page.id)}>
                        {t("افزودن سطر به صفحه", "Add line to page")}
                      </Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </Section>

      <Callout tone="info" title={t("داستان در بسته‌ی خروجی", "Story in the exported pack")}>
        {t(
          "وقتی خروجی ساختید، داستان به شکلی که اپ اندروید می‌خواند (`story.title` و `story.pages` با ترجمه هر سطر و کلمه‌به‌کلمه) وارد lesson.json می‌شود و اگر صوت داستانی اضافه کرده‌اید، آن هم به صورت story.<نوع> در بسته فشرده می‌شود. داستانی که هیچ سطری ندارد، خارج می‌شود.",
          "When you export, the story enters lesson.json in the shape the Android app reads (story.title and story.pages with per-line and per-word translations), and if you added a story audio it ships in the pack as story.<ext>. A story without any line is left out.",
        )}
      </Callout>
    </div>
  );
}

function nextPageId(story: NonNullable<DraftContent["story"]>): string {
  return nextLineId("page", story.pages.map((page) => page.id));
}

function TokenRow({
  token,
  lexemes,
  onChange,
  onRemove,
}: {
  token: Token;
  lexemes: { value: string; label: string }[];
  onChange: (patch: Partial<Token>) => void;
  onRemove: () => void;
}): React.ReactElement {
  const { t } = useLang();
  return (
    <div className="token-row">
      <TextInput value={token.surface} dir="ltr" mono onChange={(value) => onChange({ surface: value })} />
      <TextInput value={token.translationFa} dir="rtl" onChange={(value) => onChange({ translationFa: value })} />
      <TextInput value={token.translationEn} dir="ltr" onChange={(value) => onChange({ translationEn: value })} />
      <Select
        value={token.lexemeId ?? ""}
        onChange={(value) => onChange({ lexemeId: value ? value : undefined })}
        options={[{ value: "", label: t("— بدون واژه —", "— no lexeme —") }, ...lexemes]}
      />
      <Button size="sm" variant="ghost" onClick={onRemove} title="remove">
        ✕
      </Button>
    </div>
  );
}
