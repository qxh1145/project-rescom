"use client";

import { useState, type ReactNode } from "react";
import type { FormBlock, FormBlockType } from "@rescom/schemas";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { expectedAnswerLabel, type AiAttentionSuggestion } from "@/lib/forms/builder-ai";
import {
  addOption,
  changeBlockType,
  defaultExpectedValue,
  isAttentionCheck,
  isChoiceBlock,
  removeOption,
  sectionOfBlock,
  setAttentionCheck,
  setConsistencyPair,
  summarizeDoc,
  supportsAttentionCheck,
  updateBlock,
  updateOptionLabel,
} from "@/lib/forms/builder-blocks";
import { BLOCK_TYPES, blockTypeInfo } from "@/lib/forms/builder-catalog";
import type { BuilderEditor } from "../hooks/use-builder-editor";
import { GripIcon, Toggle } from "./BuilderBits";

const FIELD =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3 text-body-sm font-medium text-ink placeholder:text-ink-placeholder focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none read-only:bg-surface-muted";
const INPUT = `${FIELD} h-11`;
const LABEL = "text-caption font-bold text-ink";

function Field({ id, label, children, hint }: { id: string; label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function SelectBox({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={`${INPUT} appearance-none pr-9`}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className="pointer-events-none absolute top-3.5 right-3 text-ink-muted" />
    </div>
  );
}

function answerOptions(block: FormBlock): { value: string; label: string }[] {
  if (block.type === "single_choice" || block.type === "multiple_choice") {
    return block.options.map((option) => ({ value: option.value, label: option.label }));
  }
  if (block.type === "rating") {
    return Array.from({ length: block.maxRating }, (_, i) => ({ value: String(i + 1), label: `${i + 1} sao` }));
  }
  if (block.type === "linear_scale") {
    const values: { value: string; label: string }[] = [];
    for (let v = block.min; v <= block.max; v += block.step || 1) values.push({ value: String(v), label: String(v) });
    return values;
  }
  return [];
}

function parseAnswer(block: FormBlock, raw: string): AiAttentionSuggestion["expectedValue"] {
  if (block.type === "rating" || block.type === "linear_scale") return Number(raw);
  if (block.type === "multiple_choice") return [raw];
  return raw;
}

function firstAnswer(value: AiAttentionSuggestion["expectedValue"] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? (value[0] ?? "") : String(value);
}

function Tips() {
  return (
    <ul className="mt-4 flex flex-col gap-2.5 rounded-[14px] bg-surface-muted px-4 py-3.5 text-caption leading-[18.9px] text-ink-strong">
      <li>
        <b>Form ngắn dễ đủ mẫu hơn.</b> 5 đến 10 phút là mức người làm sẵn sàng nhất.
      </li>
      <li>
        <b>Form tạo ở đây rẻ hơn 20%</b> so với Google Forms cùng thời lượng.
      </li>
      <li>
        <b>Sau khi gửi duyệt,</b> muốn sửa sẽ tạo phiên bản mới; câu trả lời cũ vẫn gắn với phiên bản cũ.
      </li>
    </ul>
  );
}

/**
 * Figma 13 "Thuộc tính câu hỏi" aside: empty state (63:4428), question
 * settings with "Chất lượng dữ liệu" (72:450) and the AI attention-check
 * confirmation (63:1073).
 */
export function PropertiesPanel({ editor }: { editor: BuilderEditor }) {
  const { doc, selectedId, readOnly } = editor;
  const block = selectedId ? doc.blocks.find((candidate) => candidate.id === selectedId) : undefined;
  const [pairOpen, setPairOpen] = useState(false);

  if (!block) {
    return (
      <div className="px-5 py-6">
        <h2 className="text-lead font-extrabold text-ink">Chưa chọn câu hỏi</h2>
        <p className="mt-3 text-body-sm leading-[21.7px] text-ink-muted">
          Chọn một câu trong form để sửa nội dung, lựa chọn, bắt buộc và cài đặt chất lượng dữ liệu.
        </p>
        {editor.pending.length > 0 ? (
          <div className="mt-4 rounded-[14px] bg-tone-amber-bg px-4 py-3.5 text-caption text-tone-amber-ink">
            <p className="font-bold text-ink">Còn {editor.pending.length} gợi ý kiểm tra chú ý chờ xác nhận</p>
            <ul className="mt-2 flex flex-col gap-1">
              {editor.pending.map((item) => {
                const index = doc.blocks.findIndex((b) => b.id === item.blockId);
                return (
                  <li key={item.blockId}>
                    <button type="button" className="font-bold text-primary underline" onClick={() => editor.select(item.blockId)}>
                      Xem câu {index + 1}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <Tips />
      </div>
    );
  }

  const index = doc.blocks.findIndex((candidate) => candidate.id === block.id);
  const number = index + 1;
  const section = sectionOfBlock(doc, block.id);
  const sectionLabel = section ? `Phần ${doc.sections.indexOf(section) + 1} · ${section.title}` : null;
  const pending = editor.pending.find((item) => item.blockId === block.id);
  const update = (next: FormBlock, message?: string) => editor.change((current) => updateBlock(current, block.id, next), message);
  const id = (suffix: string) => `prop-${block.id}-${suffix}`;

  if (pending) {
    return <PendingSuggestion editor={editor} block={block} number={number} sectionLabel={sectionLabel} pending={pending} />;
  }

  const attentionNumbers = summarizeDoc(doc).attentionNumbers.filter((n) => n !== number);
  const pair = block.integrity?.consistencyPair;
  const others = doc.blocks.filter((candidate) => candidate.id !== block.id && candidate.type === block.type);

  return (
    <div className="flex flex-col gap-4 px-5 py-4.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-tone-green-bg text-primary">
          <Icon name={blockTypeInfo(block.type).icon} size={18} />
        </span>
        <div>
          <h2 className="text-lead font-extrabold text-ink">Câu {number}</h2>
          {sectionLabel ? <p className="text-[12px] text-ink-muted">{sectionLabel}</p> : null}
        </div>
      </div>

      <Field id={id("type")} label="Loại câu hỏi">
        <SelectBox
          id={id("type")}
          value={block.type}
          onChange={(type) =>
            editor.change((current) => changeBlockType(current, block.id, type as FormBlockType), `Đã đổi câu ${number} sang ${blockTypeInfo(type as FormBlockType).label}.`)
          }
          options={BLOCK_TYPES.map((info) => ({ value: info.type, label: info.label }))}
        />
      </Field>

      <Field id={id("title")} label="Câu hỏi">
        <textarea
          id={id("title")}
          value={block.title}
          readOnly={readOnly}
          maxLength={500}
          rows={2}
          onChange={(event) => update({ ...block, title: event.target.value } as FormBlock)}
          className={`${FIELD} min-h-16 resize-y py-2.5 leading-[21px]`}
        />
      </Field>

      <Field id={id("description")} label={<>Mô tả <span className="font-medium text-ink-muted">(không bắt buộc)</span></>}>
        <input
          id={id("description")}
          value={block.description ?? ""}
          readOnly={readOnly}
          maxLength={2000}
          placeholder="Giải thích thêm nếu cần"
          onChange={(event) => {
            const next = { ...block, description: event.target.value } as FormBlock;
            if (!event.target.value) delete next.description;
            update(next);
          }}
          className={INPUT}
        />
      </Field>

      <TypeSettings block={block} readOnly={readOnly} update={update} id={id} />

      <div className="flex flex-col gap-4 border-t border-line-subtle pt-4">
        <Toggle
          id={id("required")}
          checked={block.required}
          disabled={readOnly}
          onChange={(required) => update({ ...block, required } as FormBlock, required ? `Câu ${number} là câu bắt buộc.` : `Câu ${number} không bắt buộc.`)}
          label="Bắt buộc trả lời"
        />
      </div>

      <section aria-labelledby={id("quality")} className="flex flex-col gap-3.5 border-t border-line-subtle pt-3.5">
        <h3 id={id("quality")} className="flex items-center gap-1.5 text-caption font-extrabold text-ink">
          <Icon name="shield-check" size={16} className="text-tone-amber-strong" />
          Chất lượng dữ liệu
        </h3>
        {supportsAttentionCheck(block) ? (
          <>
            <Toggle
              id={id("attention")}
              checked={isAttentionCheck(block)}
              disabled={readOnly}
              onChange={(on) =>
                update(setAttentionCheck(block, on ? defaultExpectedValue(block) : null), on ? `Câu ${number} là câu kiểm tra chú ý.` : `Câu ${number} không còn là câu kiểm tra chú ý.`)
              }
              label="Là câu kiểm tra chú ý"
              description={`Chỉ dùng cho câu có đáp án đúng rõ ràng.${
                attentionNumbers.length > 0 ? ` Form này đã có ${attentionNumbers.length} câu (câu ${attentionNumbers.join(", ")}).` : ""
              }`}
            />
            {isAttentionCheck(block) ? (
              <Field id={id("expected")} label="Đáp án đúng" hint="Câu trả lời sai chỉ là tín hiệu để đánh giá chất lượng, không tự động loại người trả lời.">
                <SelectBox
                  id={id("expected")}
                  value={firstAnswer(block.integrity?.attentionCheck?.expectedValue)}
                  onChange={(raw) => update(setAttentionCheck(block, parseAnswer(block, raw)))}
                  options={answerOptions(block)}
                />
              </Field>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-ink-muted">Loại câu này không dùng làm câu kiểm tra chú ý.</p>
        )}

        {pair || pairOpen ? (
          <div className="flex flex-col gap-2.5 rounded-[12px] bg-surface-muted p-3">
            <Field id={id("pair")} label="Liên kết nhất quán với câu">
              <SelectBox
                id={id("pair")}
                value={pair?.pairedBlockId ?? ""}
                onChange={(pairedBlockId) =>
                  update(setConsistencyPair(block, pairedBlockId ? { pairedBlockId, rule: pair?.rule ?? "EQUIVALENT" } : null))
                }
                options={[
                  { value: "", label: "Không liên kết" },
                  ...others.map((other) => ({ value: other.id, label: `Câu ${doc.blocks.indexOf(other) + 1}: ${other.title.slice(0, 40)}` })),
                ]}
              />
            </Field>
            {pair ? (
              <Field id={id("rule")} label="Quan hệ">
                <SelectBox
                  id={id("rule")}
                  value={pair.rule}
                  onChange={(rule) => update(setConsistencyPair(block, { ...pair, rule: rule as "EQUIVALENT" | "OPPOSITE" }))}
                  options={[
                    { value: "EQUIVALENT", label: "Trả lời giống nhau" },
                    { value: "OPPOSITE", label: "Trả lời ngược nhau" },
                  ]}
                />
              </Field>
            ) : null}
            {others.length === 0 ? <p className="text-[12px] text-ink-muted">Cần thêm một câu cùng loại để liên kết.</p> : null}
          </div>
        ) : !readOnly ? (
          <button
            type="button"
            onClick={() => setPairOpen(true)}
            className="inline-flex items-center gap-1 self-start text-body-sm font-bold text-primary"
          >
            <Icon name="plus" size={16} />
            Liên kết nhất quán với câu khác
          </button>
        ) : null}
      </section>
    </div>
  );
}

function TypeSettings({
  block,
  readOnly,
  update,
  id,
}: {
  block: FormBlock;
  readOnly: boolean;
  update: (next: FormBlock, message?: string) => void;
  id: (suffix: string) => string;
}) {
  if (isChoiceBlock(block)) {
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className={`${LABEL} mb-2`}>Các lựa chọn</legend>
        <ul className="flex flex-col gap-1.5">
          {block.options.map((option, i) => (
            <li key={option.id} className="flex items-center gap-1">
              <GripIcon size={16} />
              <label className="sr-only" htmlFor={id(`opt-${option.id}`)}>
                Lựa chọn {i + 1}
              </label>
              <input
                id={id(`opt-${option.id}`)}
                value={option.label}
                readOnly={readOnly}
                maxLength={300}
                onChange={(event) => update(updateOptionLabel(block, option.id, event.target.value))}
                className={`${FIELD} h-10 flex-1`}
              />
              <button
                type="button"
                aria-label={`Xoá lựa chọn ${i + 1}`}
                disabled={readOnly || block.options.length <= 2}
                onClick={() => update(removeOption(block, option.id), `Đã xoá lựa chọn ${i + 1}.`)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle disabled:opacity-30"
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
        {!readOnly ? (
          <div className="mt-1 flex items-center gap-4">
            <button type="button" onClick={() => update(addOption(block), "Đã thêm lựa chọn.")} className="inline-flex items-center gap-1 text-body-sm font-bold text-primary">
              <Icon name="plus" size={16} />
              Thêm lựa chọn
            </button>
            <button
              type="button"
              aria-pressed={block.allowOther}
              onClick={() => update({ ...block, allowOther: !block.allowOther }, block.allowOther ? "Đã bỏ lựa chọn Khác." : "Đã thêm lựa chọn Khác.")}
              className="text-body-sm font-bold text-primary"
            >
              {block.allowOther ? "Bỏ “Khác”" : "Thêm “Khác”"}
            </button>
          </div>
        ) : null}
      </fieldset>
    );
  }
  switch (block.type) {
    case "text":
    case "textarea":
      return (
        <Field id={id("placeholder")} label="Gợi ý trong ô trả lời">
          <input
            id={id("placeholder")}
            value={block.placeholder ?? ""}
            readOnly={readOnly}
            maxLength={200}
            onChange={(event) => update({ ...block, placeholder: event.target.value } as FormBlock)}
            className={INPUT}
          />
        </Field>
      );
    case "number":
      return (
        <div className="grid grid-cols-2 gap-3">
          {(["min", "max"] as const).map((key) => (
            <Field key={key} id={id(key)} label={key === "min" ? "Nhỏ nhất" : "Lớn nhất"}>
              <input
                id={id(key)}
                type="number"
                inputMode="decimal"
                value={block[key] ?? ""}
                readOnly={readOnly}
                onChange={(event) => {
                  const next = { ...block } as Extract<FormBlock, { type: "number" }>;
                  if (event.target.value === "") delete next[key];
                  else next[key] = Number(event.target.value);
                  update(next);
                }}
                className={INPUT}
              />
            </Field>
          ))}
          <div className="col-span-2">
            <Toggle id={id("integer")} checked={block.integerOnly} disabled={readOnly} onChange={(integerOnly) => update({ ...block, integerOnly })} label="Chỉ nhận số nguyên" />
          </div>
        </div>
      );
    case "rating":
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("maxRating")} label="Số mức">
            <SelectBox
              id={id("maxRating")}
              value={String(block.maxRating)}
              onChange={(value) => update({ ...block, maxRating: Number(value) })}
              options={[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: String(n) }))}
            />
          </Field>
          <Field id={id("shape")} label="Kiểu">
            <SelectBox
              id={id("shape")}
              value={block.ratingShape}
              onChange={(value) => update({ ...block, ratingShape: value as "STAR" | "NUMBER" | "HEART" })}
              options={[
                { value: "STAR", label: "Sao" },
                { value: "NUMBER", label: "Số" },
                { value: "HEART", label: "Tim" },
              ]}
            />
          </Field>
        </div>
      );
    case "linear_scale":
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("min")} label="Từ">
            <SelectBox id={id("min")} value={String(block.min)} onChange={(value) => update({ ...block, min: Number(value) as 0 | 1 })} options={[{ value: "0", label: "0" }, { value: "1", label: "1" }]} />
          </Field>
          <Field id={id("max")} label="Đến">
            <SelectBox
              id={id("max")}
              value={String(block.max)}
              onChange={(value) => update({ ...block, max: Number(value), step: 1 })}
              options={[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: String(n) }))}
            />
          </Field>
          {(["minLabel", "maxLabel"] as const).map((key) => (
            <Field key={key} id={id(key)} label={key === "minLabel" ? "Nhãn đầu" : "Nhãn cuối"}>
              <input
                id={id(key)}
                value={block[key] ?? ""}
                readOnly={readOnly}
                maxLength={100}
                onChange={(event) => update({ ...block, [key]: event.target.value })}
                className={INPUT}
              />
            </Field>
          ))}
        </div>
      );
    case "date":
      return <Toggle id={id("time")} checked={block.includeTime} disabled={readOnly} onChange={(includeTime) => update({ ...block, includeTime })} label="Hỏi cả giờ" />;
    case "file_upload":
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("maxFiles")} label="Số tệp tối đa">
            <SelectBox
              id={id("maxFiles")}
              value={String(block.maxFiles)}
              onChange={(value) => update({ ...block, maxFiles: Number(value) })}
              options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            />
          </Field>
          <Field id={id("size")} label="Dung lượng (MB)">
            <SelectBox
              id={id("size")}
              value={String(block.maxFileSizeMb)}
              onChange={(value) => update({ ...block, maxFileSizeMb: Number(value) })}
              options={[1, 5, 10, 20, 50].map((n) => ({ value: String(n), label: `${n} MB` }))}
            />
          </Field>
        </div>
      );
    default:
      return null;
  }
}

/** 13c aside (63:1073): an AI-suggested attention check waiting for confirmation. */
function PendingSuggestion({
  editor,
  block,
  number,
  sectionLabel,
  pending,
}: {
  editor: BuilderEditor;
  block: FormBlock;
  number: number;
  sectionLabel: string | null;
  pending: AiAttentionSuggestion;
}) {
  const [answer, setAnswer] = useState(firstAnswer(pending.expectedValue));
  const others = editor.pending.filter((item) => item.blockId !== block.id);
  const otherNumbers = others.map((item) => editor.doc.blocks.findIndex((b) => b.id === item.blockId) + 1);
  const id = `pending-${block.id}`;
  return (
    <div className="flex flex-col gap-4 px-5 py-4.5">
      <div>
        <h2 className="text-lead font-extrabold text-ink">Câu {number} · gợi ý của AI</h2>
        {sectionLabel ? <p className="text-[12px] text-ink-muted">{sectionLabel}</p> : null}
      </div>
      <Field id={`${id}-title`} label="Câu hỏi">
        <textarea
          id={`${id}-title`}
          value={block.title}
          rows={2}
          maxLength={500}
          onChange={(event) => editor.change((current) => updateBlock(current, block.id, { ...block, title: event.target.value } as FormBlock))}
          className={`${FIELD} min-h-16 resize-y py-2.5 leading-[21px]`}
        />
      </Field>
      <Field id={`${id}-answer`} label="Đáp án đúng">
        <SelectBox id={`${id}-answer`} value={answer} onChange={setAnswer} options={answerOptions(block)} />
      </Field>
      <div className="rounded-[14px] bg-tone-amber-bg p-3.5">
        <p className="flex items-center gap-2 text-body-sm font-extrabold text-ink">
          <Icon name="shield-check" size={16} className="text-tone-amber-fg" />
          Dùng câu này để kiểm tra chú ý?
        </p>
        <p className="mt-2 text-caption leading-[19.5px] text-tone-amber-ink">
          Câu trả lời sai chỉ là một tín hiệu để đánh giá chất lượng, không tự động loại người trả lời.
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            size="md"
            radius="field"
            className="flex-1"
            leadingIcon={<Icon name="check-bold" size={16} />}
            onClick={() => editor.confirmSuggestion(block.id, parseAnswer(block, answer))}
          >
            Xác nhận
          </Button>
          <Button size="md" radius="field" variant="secondary" onClick={() => editor.dismissSuggestion(block.id)}>
            Bỏ gợi ý
          </Button>
        </div>
      </div>
      <p className="text-[12px] leading-[18px] text-ink-muted">
        Đáp án AI đề xuất: {expectedAnswerLabel(block, pending.expectedValue)}.
        {otherNumbers.length > 0
          ? ` Câu ${otherNumbers.join(", ")} cũng là gợi ý kiểm tra chú ý. Nên giữ 1 câu cho form ngắn.`
          : ""}
      </p>
    </div>
  );
}
