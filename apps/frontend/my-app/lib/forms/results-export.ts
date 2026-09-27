import { vietnamDateTimeParts } from "../format/date-time.ts";
import type { AnswerValue, FormResponses, ResultQuestion } from "./results-service.ts";
import { answerChoices, answerText, normalizeSearchText } from "./results-view.ts";

/**
 * "Xuất câu trả lời" (Figma 10e 62:3771 / 62:3932). The file is built in the
 * browser from `GET /forms/:id/responses` (ASSUMED) — no export endpoint is
 * needed: CSV here, .xlsx in `results-xlsx.ts`. Only the anonymous code
 * ("#47AD") identifies a row: no name, email or phone.
 */

export type ExportFormat = "xlsx" | "csv";
export type ExportScope = "all" | "passed";
export type MultipleChoiceLayout = "joined" | "split";

export interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  multipleChoice: MultipleChoiceLayout;
  includeSubmittedAt: boolean;
  includeDuration: boolean;
  includeQuality: boolean;
}

/** Figma defaults: .xlsx, every row, choices in one cell, time columns on, quality off. */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "xlsx",
  scope: "all",
  multipleChoice: "joined",
  includeSubmittedAt: true,
  includeDuration: true,
  includeQuality: false,
};

export type ExportCell = string | number;

export interface ExportTable {
  headers: string[];
  rows: ExportCell[][];
}

/** "2026-09-18 16:48" (Vietnam time) — sorts correctly in a spreadsheet. */
export function exportDateTime(value: string): string {
  const parts = vietnamDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` : "";
}

/** Joined multiple-choice cell separator (a comma would clash with option labels like "1,5–2,5 triệu"). */
export const CHOICE_SEPARATOR = "; ";

/** Header suffix of the free-text column of a choice question with `allowOther` (Phase 5 M4). */
export const OTHER_COLUMN_LABEL = "Khác";

function chosenValues(value: AnswerValue | undefined): string[] {
  return Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [String(value)];
}

function questionColumns(question: ResultQuestion, layout: MultipleChoiceLayout) {
  const title = `C${question.number}. ${question.title}`;
  if (question.type === "multiple_choice" && layout === "split") {
    const optionValues = new Set(question.options.map((option) => option.value));
    const columns = question.options.map((option) => ({
      header: `${title} [${option.label}]`,
      cell: (value: AnswerValue | undefined): ExportCell => (chosenValues(value).includes(option.value) ? 1 : 0),
    }));
    // A "Khác" answer is its own text: without this column the split layout would drop it.
    if (question.allowOther) {
      columns.push({
        header: `${title} [${OTHER_COLUMN_LABEL}]`,
        cell: (value: AnswerValue | undefined): ExportCell =>
          chosenValues(value)
            .filter((item) => !optionValues.has(item))
            .join(CHOICE_SEPARATOR),
      });
    }
    return columns;
  }
  return [
    {
      header: title,
      cell: (value: AnswerValue | undefined): ExportCell => {
        if (value === null || value === undefined || value === "") return "";
        if (question.type === "multiple_choice") return answerChoices(question, value).join(CHOICE_SEPARATOR);
        if (question.type === "single_choice") return answerChoices(question, value)[0] ?? "";
        if (typeof value === "number") return value;
        if (question.type === "date") return String(value);
        return Array.isArray(value) ? value.join(CHOICE_SEPARATOR) : answerText(question, value) || String(value);
      },
    },
  ];
}

export function buildExportTable(data: FormResponses, options: ExportOptions): ExportTable {
  const responses =
    options.scope === "passed" ? data.responses.filter((response) => response.quality === "PASSED") : data.responses;
  const columns = data.questions.flatMap((question) =>
    questionColumns(question, options.multipleChoice).map((column) => ({ ...column, id: question.id })),
  );
  const headers = [
    "Mã",
    ...(options.includeSubmittedAt ? ["Thời điểm nộp"] : []),
    ...(options.includeDuration ? ["Thời gian làm (giây)"] : []),
    ...columns.map((column) => column.header),
    ...(options.includeQuality ? ["Chất lượng"] : []),
  ];
  const rows = responses.map((response) => [
    `#${response.code}`,
    ...(options.includeSubmittedAt ? [exportDateTime(response.submittedAt)] : []),
    ...(options.includeDuration ? [response.durationSeconds] : []),
    ...columns.map((column) => column.cell(response.answers[column.id])),
    ...(options.includeQuality ? [response.quality === "PASSED" ? "Đạt" : "Cần xem lại"] : []),
  ]);
  return { headers, rows };
}

/** "20 dòng · 11 cột" */
export function exportShape(table: ExportTable): string {
  return `${table.rows.length} dòng · ${table.headers.length} cột`;
}

/**
 * Spreadsheet formula injection: a text cell starting with = + - @ (or a tab /
 * carriage return) is prefixed with an apostrophe so Excel shows it as text.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvCell(cell: ExportCell): string {
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  const text = neutralizeFormula(cell);
  return /[",\r\n;]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 byte order mark: Excel then reads Vietnamese text correctly. */
export const UTF8_BOM = "﻿";

/** RFC 4180 CSV (CRLF), prefixed with the BOM. */
export function toCsv(table: ExportTable): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(","));
  return `${UTF8_BOM}${lines.join("\r\n")}\r\n`;
}

/** "nhu-cau-nha-tro-gan-truong-v1-2026-09-27.csv" */
export function exportFileName(title: string, versionNumber: number, format: ExportFormat, now: Date): string {
  const slug =
    normalizeSearchText(title)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "khao-sat";
  const parts = vietnamDateTimeParts(now);
  const day = parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
  return `${slug}-v${versionNumber}${day ? `-${day}` : ""}.${format}`;
}
