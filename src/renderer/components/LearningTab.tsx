import React, { useState } from "react";
import type { DraftContent, GrammarItem, LearningTable, Phrase, Tone, Word } from "@shared/types";
import { useLang } from "../i18n";
import { Badge, Button, Callout, Field, Mono, Section, Select, Tabs, TextArea, TextInput } from "./ui";
import type { UpdateContent } from "./ProjectPage";

const TONES: Tone[] = ["blue", "mint", "amber", "coral", "rose", "apricot"];

type LearningTabId = "vocabulary" | "grammar" | "phrases" | "tables";

export function LearningTab({ content, update }: { content: DraftContent; update: UpdateContent }): React.ReactElement {
  const { t } = useLang();
  const [tab, setTab] = useState<LearningTabId>("vocabulary");

  return (
    <div className="tab-body">
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "vocabulary", label: t("واژگان", "Vocabulary"), badge: content.vocabulary.length },
          { id: "grammar", label: t("گرامر", "Grammar"), badge: content.grammar.length },
          { id: "phrases", label: t("اصطلاح و جمله", "Idioms & sentences"), badge: content.idioms.length + content.sentences.length },
          { id: "tables", label: t("جدول‌های واژه", "Vocabulary tables"), badge: content.vocabularyTables.length },
        ]}
      />

      {tab === "vocabulary" ? <VocabularyEditor content={content} update={update} /> : null}
      {tab === "grammar" ? <GrammarEditor content={content} update={update} /> : null}
      {tab === "phrases" ? <PhraseEditor content={content} update={update} /> : null}
      {tab === "tables" ? (
        <Section
          title={t("جدول‌های واژگان درس", "Lesson vocabulary tables")}
          description={t(
            "جدول‌ها داده‌اند: ستون‌ها و ردیف‌ها فقط متن یا {fa,en}. هیچ HTML/JS در بسته مجاز نیست.",
            "Tables are data: columns and rows are text or {fa,en}. No HTML/JS is allowed inside a pack.",
          )}
          actions={
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                update((draft) => {
                  draft.vocabularyTables.push(emptyTable());
                })
              }
            >
              {t("افزودن جدول", "Add table")}
            </Button>
          }
        >
          {content.vocabularyTables.length === 0 ? (
            <p className="muted">{t("جدولی تعریف نشده است.", "No table defined.")}</p>
          ) : (
            content.vocabularyTables.map((table, index) => (
              <TableEditor
                key={index}
                table={table}
                onChange={(next) =>
                  update((draft) => {
                    draft.vocabularyTables[index] = next;
                  })
                }
                onRemove={() =>
                  update((draft) => {
                    draft.vocabularyTables.splice(index, 1);
                  })
                }
              />
            ))
          )}
        </Section>
      ) : null}
    </div>
  );
}

function emptyTable(): LearningTable {
  return {
    titleFa: "جدول تازه",
    titleEn: "New table",
    columns: ["ستون ۱", "Column 2"],
    rows: [["مقدار", "value"]],
    rowHeader: true,
  };
}

function TableEditor({
  table,
  onChange,
  onRemove,
}: {
  table: LearningTable;
  onChange: (table: LearningTable) => void;
  onRemove: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<LearningTable>): void => onChange({ ...table, ...next });

  const setCell = (rowIndex: number, cellIndex: number, value: string): void => {
    const rows = table.rows.map((row) => [...row]);
    rows[rowIndex][cellIndex] = value;
    onChange({ ...table, rows });
  };

  return (
    <div className="table-editor">
      <div className="row between">
        <strong>{t("جدول", "Table")}</strong>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          {t("حذف جدول", "Remove table")}
        </Button>
      </div>
      <div className="form-grid">
        <Field label="titleFa">
          <TextInput value={table.titleFa} dir="rtl" onChange={(value) => patch({ titleFa: value })} />
        </Field>
        <Field label="titleEn">
          <TextInput value={table.titleEn} dir="ltr" onChange={(value) => patch({ titleEn: value })} />
        </Field>
        <Field label="footerFa" hint={t("اختیاری", "optional")}>
          <TextInput value={table.footerFa ?? ""} dir="rtl" onChange={(value) => patch({ footerFa: value })} />
        </Field>
        <Field label="footerEn" hint={t("اختیاری", "optional")}>
          <TextInput value={table.footerEn ?? ""} dir="ltr" onChange={(value) => patch({ footerEn: value })} />
        </Field>
      </div>

      <div className="table-scroll">
        <table className="grid-table">
          <thead>
            <tr>
              {table.columns.map((cell, cellIndex) => (
                <th key={cellIndex}>
                  <input
                    className="input grid-input"
                    value={asText(cell)}
                    onChange={(event) => {
                      const columns = [...table.columns];
                      columns[cellIndex] = event.target.value;
                      onChange({ ...table, columns });
                    }}
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {table.columns.map((_, cellIndex) => (
                  <td key={cellIndex}>
                    <input
                      className="input grid-input"
                      value={asText(row[cellIndex])}
                      onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="icon-btn"
                    onClick={() => onChange({ ...table, rows: table.rows.filter((_, index) => index !== rowIndex) })}
                    title="remove row"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row gap-sm wrap">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...table, columns: [...table.columns, ""], rows: table.rows.map((row) => [...row, ""]) })}
        >
          {t("افزودن ستون", "Add column")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange({
              ...table,
              rows: [...table.rows, table.columns.map(() => "")],
            })
          }
        >
          {t("افزودن ردیف", "Add row")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={table.columns.length <= 1}
          onClick={() =>
            onChange({
              ...table,
              columns: table.columns.slice(0, -1),
              rows: table.rows.map((row) => row.slice(0, -1)),
            })
          }
        >
          {t("حذف ستون", "Remove column")}
        </Button>
        <label className="row gap-sm tiny">
          <input
            type="checkbox"
            checked={table.rowHeader !== false}
            onChange={(event) => onChange({ ...table, rowHeader: event.target.checked })}
          />
          rowHeader
        </label>
      </div>
    </div>
  );
}

function asText(cell: unknown): string {
  if (typeof cell === "string") return cell;
  if (cell && typeof cell === "object" && "fa" in (cell as Record<string, unknown>)) {
    return String((cell as { fa: unknown }).fa ?? "");
  }
  return "";
}

function VocabularyEditor({ content, update }: { content: DraftContent; update: UpdateContent }): React.ReactElement {
  const { t } = useLang();
  return (
    <Section
      title={t("واژگان درس", "Lesson vocabulary")}
      description={t(
        "normalizedKey کلید شمارش واژهٔ یکتاست: NFC + حروف کوچک. lexemeId باید با پیشوند زبان شروع شود و پایدار بماند.",
        "normalizedKey is the unique-count key: NFC + lowercase. lexemeId must start with the target language and stay stable.",
      )}
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            update((draft) => {
              const used = new Set(draft.vocabulary.map((word) => word.lexemeId));
              let index = 1;
              while (used.has(`${draft.targetLanguage}:new-word-${index}`)) index += 1;
              draft.vocabulary.push({
                lexemeId: `${draft.targetLanguage}:new-word-${index}`,
                lemma: "",
                normalizedKey: "",
                translationFa: "",
                translationEn: "",
                example: { text: "", translationFa: "", translationEn: "" },
                tone: "blue",
              });
            })
          }
        >
          {t("افزودن واژه", "Add word")}
        </Button>
      }
    >
      {content.vocabulary.length === 0 ? (
        <p className="muted">{t("واژه‌ای تعریف نشده است.", "No vocabulary defined.")}</p>
      ) : (
        <div className="card-list">
          {content.vocabulary.map((word, index) => (
            <WordCard
              key={word.lexemeId + index}
              word={word}
              onChange={(next) =>
                update((draft) => {
                  draft.vocabulary[index] = next;
                })
              }
              onRemove={() =>
                update((draft) => {
                  draft.vocabulary.splice(index, 1);
                })
              }
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function WordCard({ word, onChange, onRemove }: { word: Word; onChange: (word: Word) => void; onRemove: () => void }): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<Word>): void => onChange({ ...word, ...next });
  return (
    <article className="card">
      <header>
        <div className="row gap-sm">
          <Badge tone="info">{word.lemma || "—"}</Badge>
          <Mono>{word.lexemeId}</Mono>
        </div>
        <div className="row gap-sm">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => patch({ normalizedKey: word.lemma.normalize("NFC").toLowerCase().trim() })}
            title="normalizeKey from lemma"
          >
            NFC key
          </Button>
          <Button size="sm" variant="danger" onClick={onRemove}>
            {t("حذف", "Remove")}
          </Button>
        </div>
      </header>
      <div className="form-grid">
        <Field label="lexemeId">
          <TextInput value={word.lexemeId} mono dir="ltr" onChange={(value) => patch({ lexemeId: value })} />
        </Field>
        <Field label="lemma">
          <TextInput value={word.lemma} dir="ltr" onChange={(value) => patch({ lemma: value })} />
        </Field>
        <Field label="normalizedKey">
          <TextInput value={word.normalizedKey} dir="ltr" mono onChange={(value) => patch({ normalizedKey: value })} />
        </Field>
        <Field label={t("تلفظ IPA", "IPA")}>
          <TextInput value={word.ipa ?? ""} dir="ltr" onChange={(value) => patch({ ipa: value })} />
        </Field>
        <Field label={t("خوانش فارسی", "Persian reading")}>
          <TextInput value={word.faReading ?? ""} dir="rtl" onChange={(value) => patch({ faReading: value })} />
        </Field>
        <Field label={t("نقش واژه (فارسی)", "part of speech (FA)")}>
          <TextInput value={word.partFa ?? ""} dir="rtl" onChange={(value) => patch({ partFa: value })} />
        </Field>
        <Field label={t("نقش واژه (انگلیسی)", "part of speech (EN)")}>
          <TextInput value={word.partEn ?? ""} dir="ltr" onChange={(value) => patch({ partEn: value })} />
        </Field>
        <Field label={t("حرف تعریف", "article")}>
          <TextInput value={word.article ?? ""} dir="ltr" onChange={(value) => patch({ article: value })} />
        </Field>
        <Field label={t("جنسیت (فارسی)", "gender (FA)")}>
          <TextInput value={word.genderFa ?? ""} dir="rtl" onChange={(value) => patch({ genderFa: value })} />
        </Field>
        <Field label={t("جنسیت (انگلیسی)", "gender (EN)")}>
          <TextInput value={word.genderEn ?? ""} dir="ltr" onChange={(value) => patch({ genderEn: value })} />
        </Field>
        <Field label={t("جمع", "plural")}>
          <TextInput value={word.plural ?? ""} dir="ltr" onChange={(value) => patch({ plural: value })} />
        </Field>
        <Field label="tone">
          <Select
            value={(word.tone ?? "blue") as Tone}
            onChange={(value) => patch({ tone: value })}
            options={TONES.map((tone) => ({ value: tone, label: tone }))}
          />
        </Field>
        <Field label={t("معنی فارسی", "meaning (FA)")}>
          <TextArea value={word.translationFa} rows={2} dir="rtl" onChange={(value) => patch({ translationFa: value })} />
        </Field>
        <Field label={t("معنی انگلیسی", "meaning (EN)")}>
          <TextArea value={word.translationEn} rows={2} dir="ltr" onChange={(value) => patch({ translationEn: value })} />
        </Field>
      </div>
      <div className="sub-block">
        <strong>{t("مثال", "Example")}</strong>
        <div className="form-grid">
          <Field label={t("جمله", "sentence")} wide>
            <TextInput
              value={word.example.text}
              dir="ltr"
              onChange={(value) => patch({ example: { ...word.example, text: value } })}
            />
          </Field>
          <Field label="translationFa">
            <TextArea
              value={word.example.translationFa}
              rows={2}
              dir="rtl"
              onChange={(value) => patch({ example: { ...word.example, translationFa: value } })}
            />
          </Field>
          <Field label="translationEn">
            <TextArea
              value={word.example.translationEn}
              rows={2}
              dir="ltr"
              onChange={(value) => patch({ example: { ...word.example, translationEn: value } })}
            />
          </Field>
        </div>
      </div>
    </article>
  );
}

function GrammarEditor({ content, update }: { content: DraftContent; update: UpdateContent }): React.ReactElement {
  const { t } = useLang();
  return (
    <Section
      title={t("کارت‌های گرامر", "Grammar cards")}
      description={t(
        "هر کارت یک نکتهٔ آموزشی است؛ conceptId اختیاری برای شمارش مفاهیم یکتا. جدول‌ها داخل کارت داده‌اند.",
        "Each card is one grammar item; the optional conceptId enables unique-concept counting. Tables inside cards are data.",
      )}
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            update((draft) => {
              let index = 1;
              const used = new Set(draft.grammar.map((item) => item.id));
              while (used.has(`grammar-${index}`)) index += 1;
              draft.grammar.push({
                id: `grammar-${index}`,
                tagFa: "نکته",
                tagEn: "Note",
                titleFa: "",
                titleEn: "",
                bodyFa: "",
                bodyEn: "",
                example: { text: "", translationFa: "", translationEn: "" },
                tone: "blue",
                tables: [],
              });
            })
          }
        >
          {t("افزودن نکته", "Add card")}
        </Button>
      }
    >
      {content.grammar.length === 0 ? (
        <p className="muted">{t("نکته‌ای تعریف نشده است.", "No grammar card yet.")}</p>
      ) : (
        <div className="card-list">
          {content.grammar.map((item, index) => (
            <GrammarCard
              key={item.id + index}
              item={item}
              onChange={(next) =>
                update((draft) => {
                  draft.grammar[index] = next;
                })
              }
              onRemove={() =>
                update((draft) => {
                  draft.grammar.splice(index, 1);
                })
              }
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function GrammarCard({ item, onChange, onRemove }: { item: GrammarItem; onChange: (item: GrammarItem) => void; onRemove: () => void }): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<GrammarItem>): void => onChange({ ...item, ...next });
  return (
    <article className="card">
      <header>
        <div className="row gap-sm">
          <Badge tone="info">{item.titleFa || item.titleEn || "—"}</Badge>
          <Mono>{item.id}</Mono>
        </div>
        <Button size="sm" variant="danger" onClick={onRemove}>
          {t("حذف", "Remove")}
        </Button>
      </header>
      <div className="form-grid">
        <Field label="id">
          <TextInput value={item.id} mono dir="ltr" onChange={(value) => patch({ id: value })} />
        </Field>
        <Field label="conceptId" hint={t("اختیاری، مثل en:present-continuous", "optional, e.g. en:present-continuous")}>
          <TextInput value={item.conceptId ?? ""} mono dir="ltr" onChange={(value) => patch({ conceptId: value || undefined })} />
        </Field>
        <Field label="tagFa">
          <TextInput value={item.tagFa} dir="rtl" onChange={(value) => patch({ tagFa: value })} />
        </Field>
        <Field label="tagEn">
          <TextInput value={item.tagEn} dir="ltr" onChange={(value) => patch({ tagEn: value })} />
        </Field>
        <Field label="titleFa">
          <TextInput value={item.titleFa} dir="rtl" onChange={(value) => patch({ titleFa: value })} />
        </Field>
        <Field label="titleEn">
          <TextInput value={item.titleEn} dir="ltr" onChange={(value) => patch({ titleEn: value })} />
        </Field>
        <Field label="bodyFa">
          <TextArea value={item.bodyFa} rows={3} dir="rtl" onChange={(value) => patch({ bodyFa: value })} />
        </Field>
        <Field label="bodyEn">
          <TextArea value={item.bodyEn} rows={3} dir="ltr" onChange={(value) => patch({ bodyEn: value })} />
        </Field>
        <Field label="takeawayFa">
          <TextInput value={item.takeawayFa ?? ""} dir="rtl" onChange={(value) => patch({ takeawayFa: value || undefined })} />
        </Field>
        <Field label="takeawayEn">
          <TextInput value={item.takeawayEn ?? ""} dir="ltr" onChange={(value) => patch({ takeawayEn: value || undefined })} />
        </Field>
        <Field label="tone">
          <Select
            value={(item.tone ?? "blue") as Tone}
            onChange={(value) => patch({ tone: value })}
            options={TONES.map((tone) => ({ value: tone, label: tone }))}
          />
        </Field>
      </div>

      <div className="sub-block">
        <strong>{t("مثال", "Example")}</strong>
        <div className="form-grid">
          <Field label={t("جمله", "sentence")} wide>
            <TextInput value={item.example.text} dir="ltr" onChange={(value) => patch({ example: { ...item.example, text: value } })} />
          </Field>
          <Field label="translationFa">
            <TextArea
              value={item.example.translationFa}
              rows={2}
              dir="rtl"
              onChange={(value) => patch({ example: { ...item.example, translationFa: value } })}
            />
          </Field>
          <Field label="translationEn">
            <TextArea
              value={item.example.translationEn}
              rows={2}
              dir="ltr"
              onChange={(value) => patch({ example: { ...item.example, translationEn: value } })}
            />
          </Field>
        </div>
      </div>

      <div className="sub-block">
        <div className="row between">
          <strong>{t("پرسش کوتاه (اختیاری)", "Quick check (optional)")}</strong>
          {item.check ? (
            <Button size="sm" variant="ghost" onClick={() => patch({ check: undefined })}>
              {t("حذف پرسش", "Remove check")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                patch({ check: { promptFa: "", promptEn: "", answerFa: "", answerEn: "" } })
              }
            >
              {t("افزودن پرسش", "Add check")}
            </Button>
          )}
        </div>
        {item.check ? (
          <div className="form-grid">
            <Field label="promptFa">
              <TextInput value={item.check.promptFa} dir="rtl" onChange={(value) => patch({ check: { ...item.check!, promptFa: value } })} />
            </Field>
            <Field label="promptEn">
              <TextInput value={item.check.promptEn} dir="ltr" onChange={(value) => patch({ check: { ...item.check!, promptEn: value } })} />
            </Field>
            <Field label="answerFa">
              <TextInput value={item.check.answerFa} dir="rtl" onChange={(value) => patch({ check: { ...item.check!, answerFa: value } })} />
            </Field>
            <Field label="answerEn">
              <TextInput value={item.check.answerEn} dir="ltr" onChange={(value) => patch({ check: { ...item.check!, answerEn: value } })} />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="sub-block">
        <div className="row between">
          <strong>{t("جدول‌های این نکته", "Tables in this card")}</strong>
          <Button size="sm" variant="ghost" onClick={() => patch({ tables: [...(item.tables ?? []), emptyTable()] })}>
            {t("افزودن جدول", "Add table")}
          </Button>
        </div>
        {(item.tables ?? []).map((table, index) => (
          <TableEditor
            key={index}
            table={table}
            onChange={(next) => {
              const tables = [...(item.tables ?? [])];
              tables[index] = next;
              patch({ tables });
            }}
            onRemove={() => patch({ tables: (item.tables ?? []).filter((_, position) => position !== index) })}
          />
        ))}
      </div>
    </article>
  );
}

function PhraseEditor({ content, update }: { content: DraftContent; update: UpdateContent }): React.ReactElement {
  const { t } = useLang();
  const renderList = (
    kind: "idioms" | "sentences",
    title: string,
    empty: string,
  ): React.ReactElement => (
    <Section
      title={title}
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            update((draft) => {
              let index = 1;
              const used = new Set(draft[kind].map((item) => item.id));
              const prefix = kind === "idioms" ? "idiom" : "sentence";
              while (used.has(`${prefix}-${index}`)) index += 1;
              draft[kind].push({
                id: `${prefix}-${index}`,
                text: "",
                translationFa: "",
                translationEn: "",
                tone: "mint",
              });
            })
          }
        >
          {t("افزودن", "Add")}
        </Button>
      }
    >
      {content[kind].length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="card-list">
          {content[kind].map((phrase, index) => (
            <PhraseCard
              key={phrase.id + index}
              phrase={phrase}
              lineIds={content.lyrics.map((line) => line.id)}
              onChange={(next) =>
                update((draft) => {
                  draft[kind][index] = next;
                })
              }
              onRemove={() =>
                update((draft) => {
                  draft[kind].splice(index, 1);
                })
              }
            />
          ))}
        </div>
      )}
    </Section>
  );

  return (
    <div className="stack">
      {renderList("idioms", t("اصطلاح‌ها", "Idioms"), t("اصطلاحی تعریف نشده است.", "No idiom defined."))}
      {renderList("sentences", t("جمله‌های کاربردی", "Useful sentences"), t("جمله‌ای تعریف نشده است.", "No sentence defined."))}
    </div>
  );
}

function PhraseCard({
  phrase,
  lineIds,
  onChange,
  onRemove,
}: {
  phrase: Phrase;
  lineIds: string[];
  onChange: (phrase: Phrase) => void;
  onRemove: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<Phrase>): void => onChange({ ...phrase, ...next });
  return (
    <article className="card">
      <header>
        <div className="row gap-sm">
          <Badge tone="info">{phrase.text || "—"}</Badge>
          <Mono>{phrase.id}</Mono>
        </div>
        <Button size="sm" variant="danger" onClick={onRemove}>
          {t("حذف", "Remove")}
        </Button>
      </header>
      <div className="form-grid">
        <Field label="id">
          <TextInput value={phrase.id} mono dir="ltr" onChange={(value) => patch({ id: value })} />
        </Field>
        <Field label="lineId" hint={t("ارجاع اختیاری به سطر", "optional line reference")}>
          <Select
            value={phrase.lineId ?? ""}
            onChange={(value) => patch({ lineId: value || undefined })}
            options={[{ value: "", label: "—" }, ...lineIds.map((id) => ({ value: id, label: id }))]}
          />
        </Field>
        <Field label={t("متن", "text")} wide>
          <TextInput value={phrase.text} dir="ltr" onChange={(value) => patch({ text: value })} />
        </Field>
        <Field label="translationFa">
          <TextArea value={phrase.translationFa} rows={2} dir="rtl" onChange={(value) => patch({ translationFa: value })} />
        </Field>
        <Field label="translationEn">
          <TextArea value={phrase.translationEn} rows={2} dir="ltr" onChange={(value) => patch({ translationEn: value })} />
        </Field>
        <Field label="contextFa">
          <TextInput value={phrase.contextFa ?? ""} dir="rtl" onChange={(value) => patch({ contextFa: value || undefined })} />
        </Field>
        <Field label="contextEn">
          <TextInput value={phrase.contextEn ?? ""} dir="ltr" onChange={(value) => patch({ contextEn: value || undefined })} />
        </Field>
      </div>
    </article>
  );
}

export { TableEditor };
