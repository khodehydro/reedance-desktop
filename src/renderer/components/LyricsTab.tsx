import React, { useState } from "react";
import { alternateLineLanguage, type DraftContent, type Token } from "@shared/types";
import { useLang } from "../i18n";
import { LINE_LANGUAGE_CODES, languageName } from "../lineLanguage";
import { PlaySegment } from "./SegmentAudio";
import { Badge, Button, Callout, Field, Mono, Select, Section, TextArea, TextInput, useToast } from "./ui";
import type { UpdateContent } from "./ProjectPage";

function nextLineId(content: DraftContent): string {
  let max = 0;
  for (const line of content.lyrics) {
    const match = /^line-(\d+)$/.exec(line.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `line-${max + 1}`;
}

export function LyricsTab({ content, update }: { content: DraftContent; update: UpdateContent }): React.ReactElement {
  const { t, lang } = useLang();
  const toast = useToast();
  const [openTokens, setOpenTokens] = useState<string | null>(content.lyrics[0]?.id ?? null);
  const lexemes = content.vocabulary.map((word) => ({ value: word.lexemeId, label: `${word.lemma} (${word.lexemeId})` }));

  const addLine = (): void => {
    const id = nextLineId(content);
    update((draft) => {
      draft.lyrics.push({ id, text: "", translationFa: "", translationEn: "", tokens: [] });
    });
    setOpenTokens(id);
  };

  const removeLine = (id: string): void => {
    if (content.lyrics.length <= 1) {
      toast.push(t("حداقل یک سطر لازم است.", "At least one line is required."), "warn");
      return;
    }
    const dependents = [
      ...content.sentences.filter((item) => item.lineId === id).map((item) => `sentence ${item.id}`),
      ...content.idioms.filter((item) => item.lineId === id).map((item) => `idiom ${item.id}`),
      ...content.questions.filter((item) => item.lineId === id).map((item) => `question ${item.id}`),
    ];
    if (dependents.length && !window.confirm(t(
      `این سطر در ${dependents.length} مورد ارجاع شده است (${dependents.join(", ")}). حذف شود؟`,
      `This line is referenced by ${dependents.length} item(s) (${dependents.join(", ")}). Delete it?`,
    ))) {
      return;
    }
    if (!window.confirm(t(`سطر «${id}» و زمان‌بندی آن حذف شود؟`, `Delete line "${id}" and its timing?`))) return;
    update((draft) => {
      draft.lyrics = draft.lyrics.filter((line) => line.id !== id);
    });
  };

  const moveLine = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= content.lyrics.length) return;
    update((draft) => {
      const [line] = draft.lyrics.splice(index, 1);
      draft.lyrics.splice(target, 0, line);
    });
  };

  /**
   * Mark a line as sung in another language. Such a line keeps its text and
   * translations but is not taught: its tokens lose their lexemes and cards /
   * questions that point to it are unlinked.
   */
  const setLineLanguage = (lineId: string, code: string): void => {
    const foreign = !!code && code !== content.targetLanguage;
    let unlinked = 0;
    update((draft) => {
      const target = draft.lyrics.find((line) => line.id === lineId);
      if (!target) return;
      if (!foreign) {
        delete target.language;
        return;
      }
      target.language = code;
      for (const token of target.tokens) {
        if (token.lexemeId) {
          delete token.lexemeId;
          unlinked += 1;
        }
      }
      for (const item of [...draft.idioms, ...draft.sentences, ...draft.questions]) {
        if (item.lineId === lineId) {
          item.lineId = undefined;
          unlinked += 1;
        }
      }
      for (const item of draft.grammar) {
        if (item.lineIds?.includes(lineId)) {
          item.lineIds = item.lineIds.filter((id) => id !== lineId);
          unlinked += 1;
        }
      }
    });
    if (foreign && unlinked > 0) {
      toast.push(
        t(
          `این سطر به زبان دیگری است و آموزش داده نمی‌شود؛ ${unlinked} ارجاع آموزشی از آن برداشته شد.`,
          `This line is in another language and is not taught; ${unlinked} learning link(s) were removed.`,
        ),
        "info",
      );
    }
  };

  const splitIntoTokens = (lineId: string): void => {
    const line = content.lyrics.find((candidate) => candidate.id === lineId);
    if (!line) return;
    const pieces = line.text.split(/\s+/).filter(Boolean);
    if (!pieces.length) return;
    update((draft) => {
      const target = draft.lyrics.find((candidate) => candidate.id === lineId);
      if (!target) return;
      target.tokens = pieces.map((surface) => ({
        surface,
        translationFa: "",
        translationEn: "",
      }));
    });
    setOpenTokens(lineId);
  };

  return (
    <div className="tab-body">
      <Section
        title={t("سطرهای متن", "Lyric lines")}
        description={t(
          "شناسهٔ هر سطر پایدار است؛ تغییر متن شناسه را عوض نمی‌کند اما بازبینی و تأیید قبلی را باطل می‌کند.",
          "Line ids stay stable; editing text does not change the id but invalidates previous review and approval.",
        )}
        actions={<Button size="sm" variant="primary" onClick={addLine}>{t("افزودن سطر", "Add line")}</Button>}
      >
        <div className="line-editor-list">
          {content.lyrics.map((line, index) => {
            const open = openTokens === line.id;
            const foreign = alternateLineLanguage(content.targetLanguage, line);
            return (
              <article key={line.id} className={`line-editor${foreign ? " is-foreign" : ""}`}>
                <header>
                  <div className="row gap-sm">
                    <PlaySegment playKey={`line:${line.id}`} ids={[line.id]} compact />
                    <Badge tone="muted">{index + 1}</Badge>
                    <Mono>{line.id}</Mono>
                    {foreign ? (
                      <span className="lang-badge" title={t("این سطر آموزش داده نمی‌شود", "This line is not taught")}>
                        {languageName(foreign, lang)} · {t("بدون آموزش", "not taught")}
                      </span>
                    ) : null}
                    <Badge tone={line.text ? "info" : "warn"}>
                      {line.tokens.length} {t("توکن", "tokens")}
                    </Badge>
                  </div>
                  <div className="row gap-sm">
                    <Button size="sm" variant="ghost" onClick={() => moveLine(index, -1)} title="move up">
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => moveLine(index, 1)} title="move down">
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpenTokens(open ? null : line.id)}>
                      {open ? t("بستن", "Close") : t("توکن‌ها", "Tokens")}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => removeLine(line.id)}>
                      {t("حذف", "Delete")}
                    </Button>
                  </div>
                </header>
                <div className="form-grid">
                  <Field
                    label={t("زبان سطر", "line language")}
                    hint={t(
                      "اگر این سطر به زبانی غیر از زبان آهنگ است، انتخاب کنید: با بج زبان نمایش داده می‌شود و آموزش داده نمی‌شود.",
                      "Pick a language when this line is not in the song language: it shows a language badge and is not taught.",
                    )}
                  >
                    <Select
                      value={line.language && line.language !== content.targetLanguage ? line.language : ""}
                      onChange={(value) => setLineLanguage(line.id, value)}
                      options={[
                        { value: "", label: `${languageName(content.targetLanguage, lang)} — ${t("زبان آهنگ", "song language")}` },
                        ...(line.language && !(LINE_LANGUAGE_CODES as readonly string[]).includes(line.language) && line.language !== content.targetLanguage
                          ? [{ value: line.language, label: `${languageName(line.language, lang)} (${line.language})` }]
                          : []),
                        ...LINE_LANGUAGE_CODES.filter((code) => code !== content.targetLanguage).map((code) => ({
                          value: code,
                          label: `${languageName(code, lang)} (${code})`,
                        })),
                      ]}
                    />
                  </Field>
                  <Field label={t("متن سطر", "line text")} wide>
                    <TextInput
                      value={line.text}
                      dir="ltr"
                      onChange={(value) =>
                        update((draft) => {
                          const target = draft.lyrics[index];
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
                          const target = draft.lyrics[index];
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
                          const target = draft.lyrics[index];
                          if (target) target.translationEn = value;
                        })
                      }
                    />
                  </Field>
                </div>

                {open ? (
                  <div className="token-editor">
                    <div className="row between">
                      <strong>{t("توکن‌های واژه‌به‌واژه", "Word-by-word tokens")}</strong>
                      <div className="row gap-sm">
                        <Button size="sm" variant="ghost" onClick={() => splitIntoTokens(line.id)}>
                          {t("ساخت خودکار از متن", "Rebuild from text")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            update((draft) => {
                              const target = draft.lyrics[index];
                              target?.tokens.push({ surface: "", translationFa: "", translationEn: "" });
                            })
                          }
                        >
                          {t("افزودن توکن", "Add token")}
                        </Button>
                      </div>
                    </div>
                    {line.tokens.length === 0 ? (
                      <Callout tone="warn" title={t("بدون توکن", "No tokens")}>
                        {t("هر سطر باید حداقل یک توکن داشته باشد.", "Every line needs at least one token.")}
                      </Callout>
                    ) : (
                      <div className="token-rows">
                        {line.tokens.map((token, tokenIndex) => (
                          <TokenRow
                            key={`${line.id}-${tokenIndex}`}
                            token={token}
                            lexemes={lexemes}
                            noTeach={!!foreign}
                            onChange={(patch) =>
                              update((draft) => {
                                const target = draft.lyrics[index]?.tokens[tokenIndex];
                                if (target) Object.assign(target, patch);
                              })
                            }
                            onRemove={() =>
                              update((draft) => {
                                draft.lyrics[index]?.tokens.splice(tokenIndex, 1);
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </Section>

      <Callout tone="info" title={t("چرا توکن‌ها مهم‌اند", "Why tokens matter")}>
        {t(
          "توکن‌ها معنی کلمه‌به‌کلمه و ارجاع به واژگان را می‌سازند. هر توکن با lexemeId باید در جدول واژگان همان بسته تعریف شده باشد.",
          "Tokens drive word-by-word meanings and vocabulary references. A token lexemeId must exist in this pack's vocabulary.",
        )}
      </Callout>
    </div>
  );
}

function TokenRow({
  token,
  lexemes,
  noTeach,
  onChange,
  onRemove,
}: {
  token: Token;
  lexemes: { value: string; label: string }[];
  /** Foreign-language line: tokens keep their glosses but get no lexeme. */
  noTeach?: boolean;
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
        disabled={noTeach}
        options={[{ value: "", label: noTeach ? t("— زبان دیگر، بدون واژه —", "— other language, no lexeme —") : t("— بدون واژه —", "— no lexeme —") }, ...lexemes]}
      />
      <Button size="sm" variant="ghost" onClick={onRemove} title="remove">
        ✕
      </Button>
    </div>
  );
}
