import React from "react";
import { alternateLineLanguage } from "@shared/types";
import type {
  ChoiceQuestion,
  DraftContent,
  MatchQuestion,
  OrderQuestion,
  Question,
  TypingQuestion,
} from "@shared/types";
import { useLang } from "../i18n";
import { PlaySegment, UnitLinker } from "./SegmentAudio";
import { Badge, Button, Callout, Field, Mono, Section, Select, TextArea, TextInput } from "./ui";
import type { UpdateContent } from "./ProjectPage";

type QuestionType = Question["type"];

const TYPE_LABEL: Record<QuestionType, { fa: string; en: string }> = {
  choice: { fa: "چهارگزینه‌ای", en: "choice" },
  match: { fa: "وصل‌کردن", en: "match" },
  order: { fa: "ساخت سطر", en: "order" },
  typing: { fa: "تایپ واژه", en: "typing" },
};

function newId(prefix: string, used: Set<string>): string {
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function makeQuestion(type: QuestionType, content: DraftContent): Question {
  const used = new Set(content.questions.map((question) => question.id));
  const id = newId(`q-${type}`, used);
  const base = {
    id,
    skillFa: "تمرین",
    skillEn: "Practice",
    promptFa: "",
    promptEn: "",
    explanationFa: "",
    explanationEn: "",
    lineId: content.lyrics.find((line) => !alternateLineLanguage(content.targetLanguage, line))?.id,
  };
  if (type === "choice") {
    const question: ChoiceQuestion = {
      ...base,
      type: "choice",
      options: [
        { id: "a", fa: "", en: "" },
        { id: "b", fa: "", en: "" },
      ],
      correctId: "a",
    };
    return question;
  }
  if (type === "match") {
    const first = content.vocabulary[0]?.lexemeId ?? `${content.targetLanguage}:word`;
    const second = content.vocabulary[1]?.lexemeId ?? first;
    const question: MatchQuestion = {
      ...base,
      type: "match",
      pairs: [
        { id: "p1", text: content.vocabulary[0]?.lemma ?? "", fa: content.vocabulary[0]?.translationFa ?? "", en: content.vocabulary[0]?.translationEn ?? "", lexemeId: first },
        { id: "p2", text: content.vocabulary[1]?.lemma ?? "", fa: content.vocabulary[1]?.translationFa ?? "", en: content.vocabulary[1]?.translationEn ?? "", lexemeId: second },
      ],
    };
    return question;
  }
  if (type === "order") {
    const question: OrderQuestion = {
      ...base,
      type: "order",
      chunks: [
        { id: "c1", text: "" },
        { id: "c2", text: "" },
      ],
    };
    return question;
  }
  const question: TypingQuestion = {
    ...base,
    type: "typing",
    context: "",
    accepted: [""],
  };
  return question;
}

export function QuizTab({ content, update }: { content: DraftContent; update: UpdateContent }): React.ReactElement {
  const { t } = useLang();
  return (
    <div className="tab-body">
      <Section
        title={t("سؤال‌های آزمون", "Quiz questions")}
        description={t(
          "چهار قالب پشتیبانی می‌شود. پاسخ درست، توضیح فارسی/انگلیسی و ارجاع واژگان/سطر در خروجی بررسی می‌شود.",
          "Four question types are supported. Correct answers, FA/EN explanations and line/lexeme references are validated before export.",
        )}
        actions={
          <div className="row gap-sm">
            {(["choice", "match", "order", "typing"] as QuestionType[]).map((type) => (
              <Button
                key={type}
                size="sm"
                variant="ghost"
                onClick={() =>
                  update((draft) => {
                    draft.questions.push(makeQuestion(type, draft));
                  })
                }
              >
                + {t(TYPE_LABEL[type].fa, TYPE_LABEL[type].en)}
              </Button>
            ))}
          </div>
        }
      >
        {content.questions.length === 0 ? (
          <Callout tone="warn" title={t("سؤالی وجود ندارد", "No questions yet")}>
            {t("بستهٔ نهایی به حداقل یک سؤال نیاز دارد.", "The published pack needs at least one question.")}
          </Callout>
        ) : (
          <div className="card-list">
            {content.questions.map((question, index) => (
              <QuestionCard
                key={question.id + index}
                question={question}
                content={content}
                onChange={(next) =>
                  update((draft) => {
                    draft.questions[index] = next;
                  })
                }
                onRemove={() =>
                  update((draft) => {
                    draft.questions.splice(index, 1);
                  })
                }
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function QuestionCard({
  question,
  content,
  onChange,
  onRemove,
}: {
  question: Question;
  content: DraftContent;
  onChange: (question: Question) => void;
  onRemove: () => void;
}): React.ReactElement {
  const { t } = useLang();
  const patch = (next: Partial<Question>): void => onChange({ ...question, ...next } as Question);

  return (
    <article className="card">
      <header>
        <div className="row gap-sm">
          <PlaySegment playKey={`question:${question.id}`} ids={question.lineId ? [question.lineId] : []} />
          <Badge tone="info">{t(TYPE_LABEL[question.type].fa, TYPE_LABEL[question.type].en)}</Badge>
          <Mono>{question.id}</Mono>
        </div>
        <Button size="sm" variant="danger" onClick={onRemove}>
          {t("حذف", "Remove")}
        </Button>
      </header>

      <div className="form-grid">
        <Field label="id">
          <TextInput value={question.id} mono dir="ltr" onChange={(value) => patch({ id: value })} />
        </Field>
        <div className="field field-wide">
          <UnitLinker
            value={question.lineId ? [question.lineId] : []}
            onChange={(ids) => patch({ lineId: ids[0] })}
            label={t("سطر مربوط (lineId) — پخش ▶ از همین سطر", "Linked line (lineId) — ▶ plays this line")}
          />
        </div>
        <Field label="skillFa">
          <TextInput value={question.skillFa} dir="rtl" onChange={(value) => patch({ skillFa: value })} />
        </Field>
        <Field label="skillEn">
          <TextInput value={question.skillEn} dir="ltr" onChange={(value) => patch({ skillEn: value })} />
        </Field>
        <Field label="promptFa">
          <TextArea value={question.promptFa} rows={2} dir="rtl" onChange={(value) => patch({ promptFa: value })} />
        </Field>
        <Field label="promptEn">
          <TextArea value={question.promptEn} rows={2} dir="ltr" onChange={(value) => patch({ promptEn: value })} />
        </Field>
        <Field label="explanationFa">
          <TextArea value={question.explanationFa} rows={2} dir="rtl" onChange={(value) => patch({ explanationFa: value })} />
        </Field>
        <Field label="explanationEn">
          <TextArea value={question.explanationEn} rows={2} dir="ltr" onChange={(value) => patch({ explanationEn: value })} />
        </Field>
        <Field
          label="relatedLexemeIds"
          hint={t("با کاما جدا کنید", "comma separated")}
          wide
        >
          <TextInput
            value={(question.relatedLexemeIds ?? []).join(", ")}
            mono
            dir="ltr"
            onChange={(value) =>
              patch({
                relatedLexemeIds: value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </div>

      {question.type === "choice" ? <ChoiceEditor question={question} onChange={onChange} /> : null}
      {question.type === "match" ? <MatchEditor question={question} content={content} onChange={onChange} /> : null}
      {question.type === "order" ? <OrderEditor question={question} onChange={onChange} /> : null}
      {question.type === "typing" ? <TypingEditor question={question} onChange={onChange} /> : null}

      <p className="tiny">
        {t("ارجاع واژگان باید در جدول واژگان بسته موجود باشد.", "Referenced lexemes must exist in this pack's vocabulary.")}
      </p>
    </article>
  );
}

function ChoiceEditor({ question, onChange }: { question: ChoiceQuestion; onChange: (question: Question) => void }): React.ReactElement {
  const { t } = useLang();
  return (
    <div className="sub-block">
      <div className="row between">
        <strong>{t("گزینه‌ها", "Options")}</strong>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange({
              ...question,
              options: [...question.options, { id: `opt-${question.options.length + 1}`, fa: "", en: "" }],
            })
          }
        >
          {t("افزودن گزینه", "Add option")}
        </Button>
      </div>
      {question.options.map((option, index) => (
        <div key={index} className="option-row">
          <label className="row gap-sm tiny">
            <input
              type="radio"
              checked={question.correctId === option.id}
              onChange={() => onChange({ ...question, correctId: option.id })}
            />
            {t("درست", "correct")}
          </label>
          <TextInput
            value={option.id}
            mono
            dir="ltr"
            onChange={(value) => {
              const options = question.options.map((item) => ({ ...item }));
              const previous = options[index].id;
              options[index].id = value;
              onChange({
                ...question,
                options,
                correctId: question.correctId === previous ? value : question.correctId,
              });
            }}
          />
          <TextInput
            value={option.fa}
            dir="rtl"
            onChange={(value) => {
              const options = question.options.map((item) => ({ ...item }));
              options[index].fa = value;
              onChange({ ...question, options });
            }}
          />
          <TextInput
            value={option.en}
            dir="ltr"
            onChange={(value) => {
              const options = question.options.map((item) => ({ ...item }));
              options[index].en = value;
              onChange({ ...question, options });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={question.options.length <= 2}
            onClick={() => onChange({ ...question, options: question.options.filter((_, position) => position !== index) })}
          >
            ✕
          </Button>
        </div>
      ))}
    </div>
  );
}

function MatchEditor({
  question,
  content,
  onChange,
}: {
  question: MatchQuestion;
  content: DraftContent;
  onChange: (question: Question) => void;
}): React.ReactElement {
  const { t } = useLang();
  const lexemes = content.vocabulary.map((word) => ({ value: word.lexemeId, label: word.lexemeId }));
  return (
    <div className="sub-block">
      <div className="row between">
        <strong>{t("جفت‌های واژه–معنی", "Word/meaning pairs")}</strong>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange({
              ...question,
              pairs: [
                ...question.pairs,
                {
                  id: `p${question.pairs.length + 1}`,
                  text: "",
                  fa: "",
                  en: "",
                  lexemeId: content.vocabulary[0]?.lexemeId ?? `${content.targetLanguage}:word`,
                },
              ],
            })
          }
        >
          {t("افزودن جفت", "Add pair")}
        </Button>
      </div>
      {question.pairs.map((pair, index) => (
        <div key={index} className="pair-row">
          <TextInput
            value={pair.id}
            mono
            dir="ltr"
            onChange={(value) => {
              const pairs = question.pairs.map((item) => ({ ...item }));
              pairs[index].id = value;
              onChange({ ...question, pairs });
            }}
          />
          <TextInput
            value={pair.text}
            dir="ltr"
            onChange={(value) => {
              const pairs = question.pairs.map((item) => ({ ...item }));
              pairs[index].text = value;
              onChange({ ...question, pairs });
            }}
          />
          <TextInput
            value={pair.fa}
            dir="rtl"
            onChange={(value) => {
              const pairs = question.pairs.map((item) => ({ ...item }));
              pairs[index].fa = value;
              onChange({ ...question, pairs });
            }}
          />
          <TextInput
            value={pair.en}
            dir="ltr"
            onChange={(value) => {
              const pairs = question.pairs.map((item) => ({ ...item }));
              pairs[index].en = value;
              onChange({ ...question, pairs });
            }}
          />
          <Select
            value={pair.lexemeId}
            onChange={(value) => {
              const pairs = question.pairs.map((item) => ({ ...item }));
              pairs[index].lexemeId = value;
              onChange({ ...question, pairs });
            }}
            options={lexemes.length ? lexemes : [{ value: pair.lexemeId, label: pair.lexemeId }]}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={question.pairs.length <= 2}
            onClick={() => onChange({ ...question, pairs: question.pairs.filter((_, position) => position !== index) })}
          >
            ✕
          </Button>
        </div>
      ))}
    </div>
  );
}

function OrderEditor({ question, onChange }: { question: OrderQuestion; onChange: (question: Question) => void }): React.ReactElement {
  const { t } = useLang();
  return (
    <div className="sub-block">
      <div className="row between">
        <strong>{t("تکه‌ها به ترتیب درست", "Chunks in the correct order")}</strong>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange({
              ...question,
              chunks: [...question.chunks, { id: `c${question.chunks.length + 1}`, text: "" }],
            })
          }
        >
          {t("افزودن تکه", "Add chunk")}
        </Button>
      </div>
      {question.chunks.map((chunk, index) => (
        <div key={index} className="chunk-row">
          <span className="line-number">{index + 1}</span>
          <TextInput
            value={chunk.id}
            mono
            dir="ltr"
            onChange={(value) => {
              const chunks = question.chunks.map((item) => ({ ...item }));
              chunks[index].id = value;
              onChange({ ...question, chunks });
            }}
          />
          <TextInput
            value={chunk.text}
            dir="ltr"
            onChange={(value) => {
              const chunks = question.chunks.map((item) => ({ ...item }));
              chunks[index].text = value;
              onChange({ ...question, chunks });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={question.chunks.length <= 2}
            onClick={() => onChange({ ...question, chunks: question.chunks.filter((_, position) => position !== index) })}
          >
            ✕
          </Button>
        </div>
      ))}
    </div>
  );
}

function TypingEditor({ question, onChange }: { question: TypingQuestion; onChange: (question: Question) => void }): React.ReactElement {
  const { t } = useLang();
  return (
    <div className="sub-block">
      <div className="form-grid">
        <Field label="context" hint={t("جمله با جای خالی", "sentence with a gap")} wide>
          <TextInput value={question.context} dir="ltr" onChange={(value) => onChange({ ...question, context: value })} />
        </Field>
        <Field label="accepted" hint={t("پاسخ‌های پذیرفته‌شده، هر خط یکی", "accepted answers, one per line")} wide>
          <TextArea
            value={question.accepted.join("\n")}
            rows={3}
            dir="ltr"
            onChange={(value) =>
              onChange({
                ...question,
                accepted: value
                  .split("\n")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </div>
    </div>
  );
}
