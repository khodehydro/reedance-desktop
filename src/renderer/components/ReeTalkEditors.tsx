import React, { useState } from "react";
import type {
  Issue,
  Level,
  ReetalkDraft,
  ReetalkGrammar,
  ReetalkLocalized,
  ReetalkPhrase,
  ReetalkQuestion,
  ReetalkTable,
  ReetalkTableCell,
  ReetalkToken,
  ReetalkTurn,
  ReetalkWord,
} from "@shared/types";
import { useLang } from "../i18n";
import { PlaySegment, UnitLinker } from "./SegmentAudio";
import { Badge, Button, Callout, Field, Mono, Section, Select, Tabs, TextArea, TextInput, useToast } from "./ui";

export type UpdateReeTalk = (mutator: (draft: ReetalkDraft) => void) => void;

const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const TURN_UNIT = { fa: "نوبت", en: "turn" };

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function issuesAt(issues: Issue[], prefix: string): Issue[] {
  return issues.filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`) || issue.path.startsWith(`${prefix}[`));
}

function IssueList({ issues }: { issues: Issue[] }): React.ReactElement | null {
  if (issues.length === 0) return null;
  return (
    <ul className="inline-issues">
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`} className={`inline-issue is-${issue.severity}`}>
          <Mono>{issue.path.replace(/^\$\./, "")}</Mono> {issue.message}
        </li>
      ))}
    </ul>
  );
}

function LocalizedFields({
  label,
  value,
  onChange,
  rows = 1,
}: {
  label: string;
  value: ReetalkLocalized;
  onChange: (value: ReetalkLocalized) => void;
  rows?: number;
}): React.ReactElement {
  return (
    <>
      <Field label={`${label} (FA)`}>
        {rows > 1 ? (
          <TextArea value={value.fa} rows={rows} dir="rtl" onChange={(fa) => onChange({ ...value, fa })} />
        ) : (
          <TextInput value={value.fa} dir="rtl" onChange={(fa) => onChange({ ...value, fa })} />
        )}
      </Field>
      <Field label={`${label} (EN)`}>
        {rows > 1 ? (
          <TextArea value={value.en} rows={rows} dir="ltr" onChange={(en) => onChange({ ...value, en })} />
        ) : (
          <TextInput value={value.en} dir="ltr" onChange={(en) => onChange({ ...value, en })} />
        )}
      </Field>
    </>
  );
}

function ExampleFields({
  value,
  onChange,
}: {
  value: { text: string; translation: ReetalkLocalized };
  onChange: (value: { text: string; translation: ReetalkLocalized }) => void;
}): React.ReactElement {
  const { t } = useLang();
  return (
    <>
      <Field label={t("مثال", "example")} wide>
        <TextInput value={value.text} dir="ltr" onChange={(text) => onChange({ ...value, text })} />
      </Field>
      <LocalizedFields label={t("ترجمهٔ مثال", "example translation")} value={value.translation} onChange={(translation) => onChange({ ...value, translation })} />
    </>
  );
}

function CardShell({
  title,
  id,
  playKey,
  evidence,
  onEvidence,
  onRemove,
  onMove,
  issues,
  children,
  evidenceRequired,
}: {
  title: string;
  id: string;
  playKey: string;
  evidence: readonly string[];
  onEvidence: (ids: string[]) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  issues: Issue[];
  children: React.ReactNode;
  evidenceRequired?: boolean;
}): React.ReactElement {
  const { t } = useLang();
  return (
    <article className={`card rt-card${issues.some((issue) => issue.severity === "error") ? " has-error" : ""}`}>
      <header>
        <div className="row gap-sm">
          <PlaySegment playKey={playKey} ids={evidence} />
          <Badge tone="info">{title || "—"}</Badge>
          <Mono>{id}</Mono>
        </div>
        <div className="row gap-sm">
          <Button size="sm" variant="ghost" onClick={() => onMove(-1)} title={t("بالا", "Move up")}>
            ↑
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onMove(1)} title={t("پایین", "Move down")}>
            ↓
          </Button>
          <Button size="sm" variant="danger" onClick={onRemove}>
            {t("حذف", "Remove")}
          </Button>
        </div>
      </header>
      <UnitLinker
        multiple
        value={evidence}
        onChange={onEvidence}
        unitName={TURN_UNIT}
        label={
          evidenceRequired
            ? t("نوبت‌های شاهد (الزامی)", "Evidence turns (required)")
            : t("نوبت‌هایی که این مورد در آن‌ها شنیده می‌شود", "Turns where this is heard")
        }
      />
      <div className="form-grid">{children}</div>
      <IssueList issues={issues} />
    </article>
  );
}

function uniqueId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

function move<T>(list: T[], index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
}

const emptyLocalized = (): ReetalkLocalized => ({ fa: "", en: "" });
const emptyExample = (): { text: string; translation: ReetalkLocalized } => ({ text: "", translation: emptyLocalized() });

/** Turns that mention this text (case-insensitive) — a sensible default for evidence. */
function turnsMentioning(content: ReetalkDraft, text: string): string[] {
  const needle = text.trim().toLocaleLowerCase();
  if (!needle) return [];
  return content.turns.filter((turn) => turn.text.toLocaleLowerCase().includes(needle)).map((turn) => turn.id);
}

/* ------------------------------------------------------------------ */
/* Dialogue tab: identity, speakers, turns                             */
/* ------------------------------------------------------------------ */

function nextTurnId(content: ReetalkDraft): string {
  let max = 0;
  let width = 2;
  for (const turn of content.turns) {
    const match = /^turn-(\d+)$/.exec(turn.id);
    if (match) {
      max = Math.max(max, Number(match[1]));
      width = Math.max(width, match[1].length);
    }
  }
  return `turn-${String(max + 1).padStart(width, "0")}`;
}

/** Rebuild tokens from the text, keeping glosses of surfaces that did not change. */
function rebuildTokens(turn: ReetalkTurn): ReetalkToken[] {
  const pieces = turn.text.split(/\s+/).filter(Boolean);
  const pool = new Map<string, ReetalkToken[]>();
  for (const token of turn.tokens) {
    const key = token.surface.toLocaleLowerCase();
    pool.set(key, [...(pool.get(key) ?? []), token]);
  }
  return pieces.map((surface) => {
    const reuse = pool.get(surface.toLocaleLowerCase())?.shift();
    return { surface, gloss: reuse ? { ...reuse.gloss } : emptyLocalized() };
  });
}

function evidenceUsers(content: ReetalkDraft, turnId: string): string[] {
  const { words, grammar, phrases, questions } = content.learning;
  return [
    ...words.filter((item) => item.evidenceTurnIds?.includes(turnId)).map((item) => `word ${item.id}`),
    ...grammar.filter((item) => item.evidenceTurnIds?.includes(turnId)).map((item) => `grammar ${item.id}`),
    ...phrases.filter((item) => item.evidenceTurnIds?.includes(turnId)).map((item) => `phrase ${item.id}`),
    ...questions.filter((item) => item.evidenceTurnIds.includes(turnId)).map((item) => `question ${item.id}`),
  ];
}

export function ReeTalkDialogueTab({
  content,
  update,
  issues,
}: {
  content: ReetalkDraft;
  update: UpdateReeTalk;
  issues: Issue[];
}): React.ReactElement {
  const { t } = useLang();
  const toast = useToast();
  const [openTokens, setOpenTokens] = useState<string | null>(null);
  const speakerOptions = content.speakers.map((speaker) => ({ value: speaker.id, label: speaker.name || speaker.id }));
  const speakerTone = new Map(content.speakers.map((speaker, index) => [speaker.id, index]));

  const addTurn = (afterIndex: number): void => {
    const id = nextTurnId(content);
    const previous = content.turns[afterIndex];
    const other = content.speakers.find((speaker) => speaker.id !== previous?.speakerId) ?? content.speakers[0];
    update((draft) => {
      draft.turns.splice(afterIndex + 1, 0, { id, speakerId: other?.id ?? "", text: "", translation: emptyLocalized(), tokens: [] });
    });
    setOpenTokens(id);
  };

  const removeTurn = (turnId: string): void => {
    const users = evidenceUsers(content, turnId);
    const question = users.length
      ? t(
          `این نوبت شاهد ${users.length} مورد است (${users.join(", ")}). حذف شود؟ ارجاع‌ها هم برداشته می‌شوند.`,
          `This turn is evidence for ${users.length} item(s) (${users.join(", ")}). Delete it? The links are removed too.`,
        )
      : t(`نوبت «${turnId}» و زمان‌بندی آن حذف شود؟`, `Delete turn "${turnId}" and its timing?`);
    if (!window.confirm(question)) return;
    update((draft) => {
      draft.turns = draft.turns.filter((turn) => turn.id !== turnId);
      const strip = (ids: string[] | undefined): string[] | undefined => ids?.filter((id) => id !== turnId);
      for (const item of draft.learning.words) item.evidenceTurnIds = strip(item.evidenceTurnIds);
      for (const item of draft.learning.grammar) item.evidenceTurnIds = strip(item.evidenceTurnIds);
      for (const item of draft.learning.phrases) item.evidenceTurnIds = strip(item.evidenceTurnIds);
      for (const item of draft.learning.questions) item.evidenceTurnIds = strip(item.evidenceTurnIds) ?? [];
    });
  };

  const identityIssues = issues.filter((issue) => /^\$\.(title|objective|level|speakers|categoryId)/.test(issue.path));
  const turnCountIssues = issues.filter((issue) => issue.path === "$.turns");

  return (
    <div className="tab-body">
      <Section
        title={t("مشخصات مکالمه", "Dialogue details")}
        description={t(
          "شناسهٔ مکالمه، زبان و شناسهٔ گوینده‌ها ثابت‌اند؛ عنوان، هدف، سطح و نام گوینده‌ها قابل ویرایش‌اند.",
          "The dialogue id, language and speaker ids are fixed; title, objective, level and speaker names are editable.",
        )}
      >
        <div className="form-grid">
          <LocalizedFields label={t("عنوان", "title")} value={content.title} onChange={(title) => update((draft) => void (draft.title = title))} />
          <LocalizedFields
            label={t("هدف یادگیری", "objective")}
            value={content.objective}
            rows={2}
            onChange={(objective) => update((draft) => void (draft.objective = objective))}
          />
          <Field label={t("سطح", "level")}>
            <Select value={content.level} onChange={(level) => update((draft) => void (draft.level = level))} options={LEVELS.map((level) => ({ value: level, label: level }))} />
          </Field>
          <Field label="categoryId">
            <TextInput value={content.categoryId} mono dir="ltr" onChange={(categoryId) => update((draft) => void (draft.categoryId = categoryId))} />
          </Field>
          {content.speakers.map((speaker, index) => (
            <React.Fragment key={speaker.id}>
              <Field label={t(`گویندهٔ ${index + 1}`, `speaker ${index + 1}`)} hint={speaker.id}>
                <TextInput value={speaker.name} dir="ltr" onChange={(name) => update((draft) => void (draft.speakers[index].name = name))} />
              </Field>
              <Field label={t("جنسیت صدا", "voice")}>
                <Select
                  value={speaker.gender}
                  onChange={(gender) => update((draft) => void (draft.speakers[index].gender = gender))}
                  options={[
                    { value: "woman", label: t("زن", "woman") },
                    { value: "man", label: t("مرد", "man") },
                  ]}
                />
              </Field>
            </React.Fragment>
          ))}
        </div>
        <IssueList issues={identityIssues} />
      </Section>

      <Section
        title={t(`نوبت‌ها (${content.turns.length})`, `Turns (${content.turns.length})`)}
        description={t(
          "ترتیب آرایه همان ترتیب گفت‌وگوست. توکن‌ها باید دقیقاً متن نوبت را بسازند. تغییر متن، زمان را نگه می‌دارد ولی نیاز به بازبینی دارد.",
          "Array order is conversation order. Tokens must rebuild the turn text exactly. Editing text keeps the timing but needs review.",
        )}
        actions={
          <Button size="sm" variant="primary" onClick={() => addTurn(content.turns.length - 1)}>
            {t("افزودن نوبت", "Add turn")}
          </Button>
        }
      >
        <IssueList issues={turnCountIssues} />
        <div className="line-editor-list">
          {content.turns.map((turn, index) => {
            const open = openTokens === turn.id;
            const turnIssues = issuesAt(issues, `$.turns[${index}]`);
            return (
              <article key={turn.id} className={`line-editor rt-turn tone-${speakerTone.get(turn.speakerId) === 1 ? 1 : 0}`}>
                <header>
                  <div className="row gap-sm">
                    <PlaySegment playKey={`turn:${turn.id}`} ids={[turn.id]} compact />
                    <Badge tone="muted">{index + 1}</Badge>
                    <Mono>{turn.id}</Mono>
                    <Badge tone={turn.tokens.length ? "info" : "warn"}>
                      {turn.tokens.length} {t("توکن", "tokens")}
                    </Badge>
                  </div>
                  <div className="row gap-sm">
                    <Button size="sm" variant="ghost" onClick={() => update((draft) => move(draft.turns, index, -1))} title={t("بالا", "Move up")}>
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => update((draft) => move(draft.turns, index, 1))} title={t("پایین", "Move down")}>
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => addTurn(index)} title={t("نوبت جدید بعد از این", "New turn after this one")}>
                      +
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpenTokens(open ? null : turn.id)}>
                      {open ? t("بستن", "Close") : t("توکن‌ها", "Tokens")}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => removeTurn(turn.id)}>
                      {t("حذف", "Delete")}
                    </Button>
                  </div>
                </header>
                <div className="form-grid">
                  <Field label={t("گوینده", "speaker")}>
                    <Select value={turn.speakerId} onChange={(speakerId) => update((draft) => void (draft.turns[index].speakerId = speakerId))} options={speakerOptions} />
                  </Field>
                  <Field label={t("متن نوبت", "turn text")} wide>
                    <TextInput value={turn.text} dir="ltr" onChange={(text) => update((draft) => void (draft.turns[index].text = text))} />
                  </Field>
                  <LocalizedFields
                    label={t("ترجمه", "translation")}
                    value={turn.translation}
                    rows={2}
                    onChange={(translation) => update((draft) => void (draft.turns[index].translation = translation))}
                  />
                </div>
                {open ? (
                  <div className="token-editor">
                    <div className="row between">
                      <strong>{t("توکن‌های واژه‌به‌واژه", "Word-by-word tokens")}</strong>
                      <div className="row gap-sm">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            update((draft) => void (draft.turns[index].tokens = rebuildTokens(draft.turns[index])));
                            toast.push(t("توکن‌ها از متن ساخته شدند؛ معنی کلمه‌های تکراری حفظ شد.", "Tokens rebuilt from the text; unchanged glosses were kept."), "info");
                          }}
                        >
                          {t("ساخت خودکار از متن", "Rebuild from text")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => update((draft) => void draft.turns[index].tokens.push({ surface: "", gloss: emptyLocalized() }))}
                        >
                          {t("افزودن توکن", "Add token")}
                        </Button>
                      </div>
                    </div>
                    <div className="token-rows">
                      {turn.tokens.map((token, tokenIndex) => (
                        <div className="token-row rt-token-row" key={`${turn.id}-${tokenIndex}`}>
                          <TextInput
                            value={token.surface}
                            dir="ltr"
                            placeholder="surface"
                            onChange={(surface) => update((draft) => void (draft.turns[index].tokens[tokenIndex].surface = surface))}
                          />
                          <TextInput
                            value={token.gloss.fa}
                            dir="rtl"
                            placeholder="fa"
                            onChange={(fa) => update((draft) => void (draft.turns[index].tokens[tokenIndex].gloss.fa = fa))}
                          />
                          <TextInput
                            value={token.gloss.en}
                            dir="ltr"
                            placeholder="en"
                            onChange={(en) => update((draft) => void (draft.turns[index].tokens[tokenIndex].gloss.en = en))}
                          />
                          <Button size="sm" variant="ghost" onClick={() => update((draft) => void draft.turns[index].tokens.splice(tokenIndex, 1))}>
                            ×
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <IssueList issues={turnIssues} />
              </article>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Learning tab: words, grammar, phrases, questions                    */
/* ------------------------------------------------------------------ */

type Block = "words" | "grammar" | "phrases" | "questions";

function TableEditor({
  table,
  onChange,
  onRemove,
}: {
  table: ReetalkTable;
  onChange: (table: ReetalkTable) => void;
  onRemove: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const isText = (cell: ReetalkTableCell): cell is { text: string } => "text" in cell;
  const blank = (columnIndex: number): ReetalkTableCell => {
    const sample = table.rows.find((row) => row[columnIndex])?.[columnIndex];
    return sample && !isText(sample) ? { fa: "", en: "" } : { text: "" };
  };
  const setCell = (rowIndex: number, columnIndex: number, cell: ReetalkTableCell): void => {
    const rows = table.rows.map((row) => [...row]);
    rows[rowIndex][columnIndex] = cell;
    onChange({ ...table, rows });
  };
  return (
    <div className="table-editor rt-table-editor">
      <div className="row between">
        <div className="row gap-sm">
          <TextInput value={table.title.fa} dir="rtl" placeholder={t("عنوان جدول (فا)", "table title (fa)")} onChange={(fa) => onChange({ ...table, title: { ...table.title, fa } })} />
          <TextInput value={table.title.en} dir="ltr" placeholder="table title (en)" onChange={(en) => onChange({ ...table, title: { ...table.title, en } })} />
        </div>
        <div className="row gap-sm">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...table, columns: [...table.columns, emptyLocalized()], rows: table.rows.map((row) => [...row, { text: "" }]) })}
          >
            + {t("ستون", "column")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...table, rows: [...table.rows, table.columns.map((_, index) => blank(index))] })}>
            + {t("ردیف", "row")}
          </Button>
          <Button size="sm" variant="danger" onClick={onRemove}>
            {t("حذف جدول", "Remove table")}
          </Button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="rt-table">
          <thead>
            <tr>
              {table.columns.map((column, columnIndex) => (
                <th key={columnIndex}>
                  <TextInput
                    value={column.fa}
                    dir="rtl"
                    placeholder="fa"
                    onChange={(fa) => onChange({ ...table, columns: table.columns.map((item, index) => (index === columnIndex ? { ...item, fa } : item)) })}
                  />
                  <TextInput
                    value={column.en}
                    dir="ltr"
                    placeholder="en"
                    onChange={(en) => onChange({ ...table, columns: table.columns.map((item, index) => (index === columnIndex ? { ...item, en } : item)) })}
                  />
                  <button
                    type="button"
                    className="cell-mode"
                    disabled={table.columns.length <= 1}
                    onClick={() =>
                      onChange({
                        ...table,
                        columns: table.columns.filter((_, index) => index !== columnIndex),
                        rows: table.rows.map((row) => row.filter((_, index) => index !== columnIndex)),
                      })
                    }
                  >
                    × {t("ستون", "column")}
                  </button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {table.columns.map((_, columnIndex) => {
                  const cell = row[columnIndex] ?? { text: "" };
                  return (
                    <td key={columnIndex}>
                      {isText(cell) ? (
                        <TextInput value={cell.text} dir="ltr" onChange={(text) => setCell(rowIndex, columnIndex, { text })} />
                      ) : (
                        <>
                          <TextInput value={cell.fa} dir="rtl" placeholder="fa" onChange={(fa) => setCell(rowIndex, columnIndex, { ...cell, fa })} />
                          <TextInput value={cell.en} dir="ltr" placeholder="en" onChange={(en) => setCell(rowIndex, columnIndex, { ...cell, en })} />
                        </>
                      )}
                      <button
                        type="button"
                        className="cell-mode"
                        title={t("متن زبان هدف یا ترجمهٔ فا/en", "Target-language text or a fa/en pair")}
                        onClick={() => setCell(rowIndex, columnIndex, isText(cell) ? { fa: cell.text, en: "" } : { text: cell.en || cell.fa })}
                      >
                        {isText(cell) ? "text → fa/en" : "fa/en → text"}
                      </button>
                    </td>
                  );
                })}
                <td>
                  <Button size="sm" variant="ghost" onClick={() => onChange({ ...table, rows: table.rows.filter((_, index) => index !== rowIndex) })}>
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReeTalkLearningTab({
  content,
  update,
  issues,
}: {
  content: ReetalkDraft;
  update: UpdateReeTalk;
  issues: Issue[];
}): React.ReactElement {
  const { t } = useLang();
  const [block, setBlock] = useState<Block>("words");
  const { words, grammar, phrases, questions } = content.learning;
  const allIds = [...words, ...grammar, ...phrases, ...questions].map((item) => item.id);

  const confirmRemove = (id: string): boolean => window.confirm(t(`«${id}» حذف شود؟`, `Remove "${id}"?`));
  const at = (name: Block, index: number): Issue[] => issuesAt(issues, `$.learning.${name}[${index}]`);
  const blockIssues = (name: Block): Issue[] => issues.filter((issue) => issue.path === `$.learning.${name}`);
  const unplayable = (list: { evidenceTurnIds?: string[] }[]): number => list.filter((item) => !item.evidenceTurnIds?.length).length;

  const addButton = (label: string, onClick: () => void): React.ReactElement => (
    <Button size="sm" variant="primary" onClick={onClick}>
      {label}
    </Button>
  );

  const evidenceHint = (list: { evidenceTurnIds?: string[] }[]): React.ReactElement | null => {
    const missing = unplayable(list);
    if (!missing) return null;
    return (
      <Callout tone="info" title={t(`${missing} کارت هنوز به نوبتی وصل نیست`, `${missing} card(s) are not linked to a turn yet`)}>
        {t(
          "با «نوبت‌های شاهد» مشخص کنید هر کارت در کدام قسمت مکالمه شنیده می‌شود تا دکمهٔ ▶ همان قسمت را پخش کند (مثل سؤال‌ها).",
          "Use “evidence turns” to say where each card is heard so ▶ plays that part of the dialogue (like the questions).",
        )}
      </Callout>
    );
  };

  return (
    <div className="tab-body">
      <Tabs
        active={block}
        onChange={setBlock}
        tabs={[
          { id: "words", label: t("لغات", "Words"), badge: words.length },
          { id: "grammar", label: t("گرامر", "Grammar"), badge: grammar.length },
          { id: "phrases", label: t("اصطلاحات", "Phrases"), badge: phrases.length },
          { id: "questions", label: t("سؤالات", "Questions"), badge: questions.length },
        ]}
      />

      {block === "words" ? (
        <Section
          title={t("لغات", "Words")}
          actions={addButton(t("افزودن لغت", "Add word"), () =>
            update((draft) =>
              void draft.learning.words.push({
                id: uniqueId("word", allIds),
                text: "",
                pronunciation: { faReading: "", ipa: "" },
                meaning: emptyLocalized(),
                example: emptyExample(),
                evidenceTurnIds: [],
              }),
            ),
          )}
        >
          <IssueList issues={blockIssues("words")} />
          {evidenceHint(words)}
          <div className="card-list">
            {words.map((word, index) => (
              <WordCard
                key={`${word.id}-${index}`}
                word={word}
                content={content}
                issues={at("words", index)}
                onChange={(next) => update((draft) => void (draft.learning.words[index] = next))}
                onMove={(direction) => update((draft) => move(draft.learning.words, index, direction))}
                onRemove={() => confirmRemove(word.id) && update((draft) => void draft.learning.words.splice(index, 1))}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {block === "grammar" ? (
        <Section
          title={t("گرامر", "Grammar")}
          actions={addButton(t("افزودن گرامر", "Add grammar"), () =>
            update((draft) =>
              void draft.learning.grammar.push({
                id: uniqueId("grammar", allIds),
                title: emptyLocalized(),
                explanation: emptyLocalized(),
                example: emptyExample(),
                takeaway: emptyLocalized(),
                tables: [{ title: emptyLocalized(), columns: [emptyLocalized(), emptyLocalized()], rows: [[{ text: "" }, { fa: "", en: "" }]] }],
                evidenceTurnIds: [],
              }),
            ),
          )}
        >
          <IssueList issues={blockIssues("grammar")} />
          {evidenceHint(grammar)}
          <div className="card-list">
            {grammar.map((item, index) => (
              <GrammarCard
                key={`${item.id}-${index}`}
                item={item}
                issues={at("grammar", index)}
                onChange={(next) => update((draft) => void (draft.learning.grammar[index] = next))}
                onMove={(direction) => update((draft) => move(draft.learning.grammar, index, direction))}
                onRemove={() => confirmRemove(item.id) && update((draft) => void draft.learning.grammar.splice(index, 1))}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {block === "phrases" ? (
        <Section
          title={t("اصطلاحات", "Phrases")}
          actions={addButton(t("افزودن اصطلاح", "Add phrase"), () =>
            update((draft) =>
              void draft.learning.phrases.push({
                id: uniqueId("phrase", allIds),
                text: "",
                pronunciation: { faReading: "", ipa: "" },
                meaning: emptyLocalized(),
                context: emptyLocalized(),
                example: emptyExample(),
                evidenceTurnIds: [],
              }),
            ),
          )}
        >
          <IssueList issues={blockIssues("phrases")} />
          {evidenceHint(phrases)}
          <div className="card-list">
            {phrases.map((item, index) => (
              <PhraseCard
                key={`${item.id}-${index}`}
                item={item}
                content={content}
                issues={at("phrases", index)}
                onChange={(next) => update((draft) => void (draft.learning.phrases[index] = next))}
                onMove={(direction) => update((draft) => move(draft.learning.phrases, index, direction))}
                onRemove={() => confirmRemove(item.id) && update((draft) => void draft.learning.phrases.splice(index, 1))}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {block === "questions" ? (
        <Section
          title={t("سؤالات", "Questions")}
          description={t(
            "حداقل یک سؤال «کلیات» و یک سؤال «جزئیات» لازم است. هر سؤال باید حداقل یک نوبت شاهد داشته باشد.",
            "At least one gist and one detail question are required. Every question needs at least one evidence turn.",
          )}
          actions={addButton(t("افزودن سؤال", "Add question"), () =>
            update((draft) => {
              const id = uniqueId("question", allIds);
              draft.learning.questions.push({
                id,
                stage: "detail",
                type: "multiple_choice",
                prompt: emptyLocalized(),
                options: [
                  { id: `${id}-a`, text: emptyLocalized() },
                  { id: `${id}-b`, text: emptyLocalized() },
                ],
                correctOptionId: `${id}-a`,
                explanation: emptyLocalized(),
                evidenceTurnIds: draft.turns[0] ? [draft.turns[0].id] : [],
              });
            }),
          )}
        >
          <IssueList issues={blockIssues("questions")} />
          <div className="card-list">
            {questions.map((item, index) => (
              <QuestionCard
                key={`${item.id}-${index}`}
                item={item}
                issues={at("questions", index)}
                onChange={(next) => update((draft) => void (draft.learning.questions[index] = next))}
                onMove={(direction) => update((draft) => move(draft.learning.questions, index, direction))}
                onRemove={() => confirmRemove(item.id) && update((draft) => void draft.learning.questions.splice(index, 1))}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

interface CardProps<T> {
  issues: Issue[];
  onChange: (next: T) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function SuggestEvidence({ content, text, onPick }: { content: ReetalkDraft; text: string; onPick: (ids: string[]) => void }): React.ReactElement | null {
  const { t } = useLang();
  const found = turnsMentioning(content, text);
  if (!found.length) return null;
  return (
    <Button size="sm" variant="ghost" onClick={() => onPick(found)} title={found.join(", ")}>
      {t(`پیدا کردن در مکالمه (${found.length})`, `Find in dialogue (${found.length})`)}
    </Button>
  );
}

function WordCard({ word, content, issues, onChange, onMove, onRemove }: CardProps<ReetalkWord> & { word: ReetalkWord; content: ReetalkDraft }): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<ReetalkWord>): void => onChange({ ...word, ...next });
  return (
    <CardShell
      title={word.text}
      id={word.id}
      playKey={`word:${word.id}`}
      evidence={word.evidenceTurnIds ?? []}
      onEvidence={(evidenceTurnIds) => patch({ evidenceTurnIds })}
      onMove={onMove}
      onRemove={onRemove}
      issues={issues}
    >
      <Field label="id">
        <TextInput value={word.id} mono dir="ltr" onChange={(id) => patch({ id })} />
      </Field>
      <Field label={t("لغت", "word")}>
        <div className="row gap-sm">
          <TextInput value={word.text} dir="ltr" onChange={(text) => patch({ text })} />
          {(word.evidenceTurnIds ?? []).length === 0 ? <SuggestEvidence content={content} text={word.text} onPick={(evidenceTurnIds) => patch({ evidenceTurnIds })} /> : null}
        </div>
      </Field>
      <Field label="IPA">
        <TextInput value={word.pronunciation.ipa} dir="ltr" onChange={(ipa) => patch({ pronunciation: { ...word.pronunciation, ipa } })} />
      </Field>
      <Field label={t("خوانش فارسی", "Persian reading")}>
        <TextInput value={word.pronunciation.faReading} dir="rtl" onChange={(faReading) => patch({ pronunciation: { ...word.pronunciation, faReading } })} />
      </Field>
      <LocalizedFields label={t("معنی", "meaning")} value={word.meaning} onChange={(meaning) => patch({ meaning })} />
      <ExampleFields value={word.example} onChange={(example) => patch({ example })} />
    </CardShell>
  );
}

function PhraseCard({ item, content, issues, onChange, onMove, onRemove }: CardProps<ReetalkPhrase> & { item: ReetalkPhrase; content: ReetalkDraft }): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<ReetalkPhrase>): void => onChange({ ...item, ...next });
  return (
    <CardShell
      title={item.text}
      id={item.id}
      playKey={`phrase:${item.id}`}
      evidence={item.evidenceTurnIds ?? []}
      onEvidence={(evidenceTurnIds) => patch({ evidenceTurnIds })}
      onMove={onMove}
      onRemove={onRemove}
      issues={issues}
    >
      <Field label="id">
        <TextInput value={item.id} mono dir="ltr" onChange={(id) => patch({ id })} />
      </Field>
      <Field label={t("اصطلاح", "phrase")} wide>
        <div className="row gap-sm">
          <TextInput value={item.text} dir="ltr" onChange={(text) => patch({ text })} />
          {(item.evidenceTurnIds ?? []).length === 0 ? <SuggestEvidence content={content} text={item.text} onPick={(evidenceTurnIds) => patch({ evidenceTurnIds })} /> : null}
        </div>
      </Field>
      <Field label="IPA">
        <TextInput value={item.pronunciation.ipa} dir="ltr" onChange={(ipa) => patch({ pronunciation: { ...item.pronunciation, ipa } })} />
      </Field>
      <Field label={t("خوانش فارسی", "Persian reading")}>
        <TextInput value={item.pronunciation.faReading} dir="rtl" onChange={(faReading) => patch({ pronunciation: { ...item.pronunciation, faReading } })} />
      </Field>
      <LocalizedFields label={t("معنی", "meaning")} value={item.meaning} onChange={(meaning) => patch({ meaning })} />
      <LocalizedFields label={t("موقعیت کاربرد", "context")} value={item.context} onChange={(context) => patch({ context })} />
      <ExampleFields value={item.example} onChange={(example) => patch({ example })} />
    </CardShell>
  );
}

function GrammarCard({ item, issues, onChange, onMove, onRemove }: CardProps<ReetalkGrammar> & { item: ReetalkGrammar }): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<ReetalkGrammar>): void => onChange({ ...item, ...next });
  return (
    <CardShell
      title={item.title.fa || item.title.en}
      id={item.id}
      playKey={`grammar:${item.id}`}
      evidence={item.evidenceTurnIds ?? []}
      onEvidence={(evidenceTurnIds) => patch({ evidenceTurnIds })}
      onMove={onMove}
      onRemove={onRemove}
      issues={issues}
    >
      <Field label="id">
        <TextInput value={item.id} mono dir="ltr" onChange={(id) => patch({ id })} />
      </Field>
      <LocalizedFields label={t("عنوان", "title")} value={item.title} onChange={(title) => patch({ title })} />
      <LocalizedFields label={t("توضیح", "explanation")} value={item.explanation} rows={3} onChange={(explanation) => patch({ explanation })} />
      <ExampleFields value={item.example} onChange={(example) => patch({ example })} />
      <LocalizedFields label={t("نکتهٔ کلیدی", "takeaway")} value={item.takeaway} onChange={(takeaway) => patch({ takeaway })} />
      <div className="field field-wide">
        <div className="row between">
          <span className="field-label">{t(`جدول‌ها (${item.tables.length})`, `Tables (${item.tables.length})`)}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => patch({ tables: [...item.tables, { title: emptyLocalized(), columns: [emptyLocalized(), emptyLocalized()], rows: [[{ text: "" }, { fa: "", en: "" }]] }] })}
          >
            + {t("جدول", "table")}
          </Button>
        </div>
        {item.tables.map((table, tableIndex) => (
          <TableEditor
            key={tableIndex}
            table={table}
            onChange={(next) => patch({ tables: item.tables.map((candidate, index) => (index === tableIndex ? next : candidate)) })}
            onRemove={() => patch({ tables: item.tables.filter((_, index) => index !== tableIndex) })}
          />
        ))}
      </div>
    </CardShell>
  );
}

function QuestionCard({ item, issues, onChange, onMove, onRemove }: CardProps<ReetalkQuestion> & { item: ReetalkQuestion }): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<ReetalkQuestion>): void => onChange({ ...item, ...next });
  const letters = "abcdef";
  const addOption = (): void => {
    const taken = new Set(item.options.map((option) => option.id));
    const letter = [...letters].find((candidate) => !taken.has(`${item.id}-${candidate}`)) ?? String(item.options.length + 1);
    patch({ options: [...item.options, { id: `${item.id}-${letter}`, text: emptyLocalized() }] });
  };
  return (
    <CardShell
      title={item.prompt.fa || item.prompt.en}
      id={item.id}
      playKey={`question:${item.id}`}
      evidence={item.evidenceTurnIds}
      onEvidence={(evidenceTurnIds) => patch({ evidenceTurnIds })}
      onMove={onMove}
      onRemove={onRemove}
      issues={issues}
      evidenceRequired
    >
      <Field label="id">
        <TextInput value={item.id} mono dir="ltr" onChange={(id) => patch({ id })} />
      </Field>
      <Field label={t("مرحله", "stage")}>
        <Select
          value={item.stage}
          onChange={(stage) => patch({ stage })}
          options={[
            { value: "gist", label: t("کلیات (gist)", "gist") },
            { value: "detail", label: t("جزئیات (detail)", "detail") },
            { value: "review", label: t("مرور (review)", "review") },
          ]}
        />
      </Field>
      <LocalizedFields label={t("سؤال", "prompt")} value={item.prompt} rows={2} onChange={(prompt) => patch({ prompt })} />
      <div className="field field-wide">
        <div className="row between">
          <span className="field-label">{t("گزینه‌ها (۲ تا ۶) — دایره = پاسخ درست", "Options (2–6) — circle = correct answer")}</span>
          <Button size="sm" variant="ghost" onClick={addOption} disabled={item.options.length >= 6}>
            + {t("گزینه", "option")}
          </Button>
        </div>
        <div className="rt-options">
          {item.options.map((option, optionIndex) => (
            <div key={`${option.id}-${optionIndex}`} className={`rt-option${option.id === item.correctOptionId ? " is-correct" : ""}`}>
              <input
                type="radio"
                name={`correct-${item.id}`}
                checked={option.id === item.correctOptionId}
                onChange={() => patch({ correctOptionId: option.id })}
                aria-label={t("پاسخ درست", "Correct answer")}
              />
              <TextInput
                value={option.text.fa}
                dir="rtl"
                placeholder="fa"
                onChange={(fa) => patch({ options: item.options.map((candidate, index) => (index === optionIndex ? { ...candidate, text: { ...candidate.text, fa } } : candidate)) })}
              />
              <TextInput
                value={option.text.en}
                dir="ltr"
                placeholder="en"
                onChange={(en) => patch({ options: item.options.map((candidate, index) => (index === optionIndex ? { ...candidate, text: { ...candidate.text, en } } : candidate)) })}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={item.options.length <= 2}
                onClick={() => {
                  const options = item.options.filter((_, index) => index !== optionIndex);
                  patch({ options, correctOptionId: option.id === item.correctOptionId ? options[0]?.id ?? "" : item.correctOptionId });
                }}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      </div>
      <LocalizedFields label={t("توضیح پاسخ", "explanation")} value={item.explanation} rows={2} onChange={(explanation) => patch({ explanation })} />
    </CardShell>
  );
}
