import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const view = await import("../lib/forms/results-view.ts");
const exporter = await import("../lib/forms/results-export.ts");
const xlsx = await import("../lib/forms/results-xlsx.ts");
const quality = await import("../lib/forms/results-quality.ts");
const versions = await import("../lib/forms/results-versions.ts");
const messages = await import("../lib/forms/results-messages.ts");
const { formResponsesSchema } = await import("../lib/forms/results-service.ts");

// --- Fixture: "Nhu cầu nhà trọ gần trường" (Figma 10d), 3 questions shown + 2 more ---

const opts = (...labels) => labels.map((label) => ({ value: label, label }));
const QUESTIONS = [
  { id: "q1", number: 1, title: "Hiện bạn đang ở đâu?", shortLabel: "Chỗ ở hiện tại", type: "single_choice", required: true, options: opts("Nhà trọ", "Ký túc xá", "Nhà người thân"), scale: null },
  { id: "q3", number: 2, title: "Ngân sách cho chỗ ở mỗi tháng?", shortLabel: "Ngân sách/tháng", type: "single_choice", required: true, options: opts("Dưới 1,5 triệu đồng", "1,5–2,5 triệu đồng"), scale: null },
  { id: "q4", number: 3, title: "Yếu tố quan trọng khi chọn chỗ ở?", shortLabel: null, type: "multiple_choice", required: true, options: opts("Giá thuê", "An ninh", "Gần trường"), scale: null },
  { id: "q5", number: 4, title: "Mức hài lòng với chỗ ở hiện tại", shortLabel: "Hài lòng", type: "linear_scale", required: true, options: [], scale: { min: 1, max: 5, minLabel: "Rất không hài lòng", maxLabel: "Rất hài lòng" } },
  { id: "q8", number: 5, title: "Điều bạn muốn cải thiện nhất?", shortLabel: null, type: "text", required: true, options: [], scale: null },
];

function response(code, overrides = {}) {
  return {
    id: `00000000-0000-4000-8000-${code.padStart(12, "0")}`,
    code,
    submittedAt: "2026-09-18T16:48:00+07:00",
    durationSeconds: 362,
    quality: "PASSED",
    reviewReasons: [],
    answers: { q1: "Nhà trọ", q3: "1,5–2,5 triệu đồng", q4: ["Giá thuê", "An ninh"], q5: 2, q8: "Phòng hay bị ẩm" },
    codeVerified: null,
    ...overrides,
  };
}

const DATA = formResponsesSchema.parse({
  form: { id: "f1", title: "Nhu cầu nhà trọ gần trường", type: "INTERNAL", versionNumber: 1, estimatedEffortSeconds: 360, externalUrl: null },
  questions: QUESTIONS,
  responses: [
    response("A1F2", { submittedAt: "2026-09-22T21:14:00+07:00", durationSeconds: 348, answers: { q1: "Nhà trọ", q3: "1,5–2,5 triệu đồng", q4: ["Gần trường"], q5: 3, q8: 'Wifi yếu, "rất" chậm' } }),
    response("3C7B", { answers: { q1: "Ký túc xá", q3: "Dưới 1,5 triệu đồng", q4: [], q5: 4, q8: "=HYPERLINK(\"x\")" } }),
    response("6B1C", { quality: "NEEDS_REVIEW", durationSeconds: 118, reviewReasons: [{ code: "TOO_FAST", params: { declaredMinutes: 6 } }] }),
    response("47AD"),
  ],
});

// --- View: filters, search, pagination, position ---

test("quality counts and filter", () => {
  assert.deepEqual(view.qualityCounts(DATA.responses), { all: 4, passed: 3, review: 1 });
  assert.equal(view.filterResponses(DATA.responses, QUESTIONS, { quality: "review", query: "" }).length, 1);
  assert.equal(view.filterResponses(DATA.responses, QUESTIONS, { quality: "passed", query: "" }).length, 3);
  assert.equal(view.parseQualityFilter("nope"), "all");
});

test("search matches code with or without # and answers without diacritics", () => {
  const find = (query) => view.filterResponses(DATA.responses, QUESTIONS, { quality: "all", query }).map((r) => r.code);
  assert.deepEqual(find("#47ad"), ["47AD"]);
  assert.deepEqual(find("ky tuc"), ["3C7B"]);
  assert.deepEqual(find("wifi"), ["A1F2"]);
  assert.equal(find("   ").length, 4);
});

test("paginate clamps the page and reports the visible range", () => {
  const items = Array.from({ length: 20 }, (_, index) => index);
  const second = view.paginate(items, 2, 10);
  assert.deepEqual([second.page, second.pageCount, second.from, second.to, second.items[0]], [2, 2, 11, 20, 10]);
  assert.equal(view.paginate(items, 9, 10).page, 2);
  const empty = view.paginate([], 1, 10);
  assert.deepEqual([empty.pageCount, empty.from, empty.to], [1, 0, 0]);
});

test("position gives previous (newer) and next (older)", () => {
  const position = view.responsePosition(DATA.responses, DATA.responses[1].id);
  assert.equal(position.index, 2);
  assert.equal(position.total, 4);
  assert.equal(position.previous.code, "A1F2");
  assert.equal(position.next.code, "6B1C");
  assert.equal(view.responsePosition(DATA.responses, "missing"), null);
});

test("default columns prefer questions with a short label", () => {
  assert.deepEqual(view.defaultColumnIds(QUESTIONS), ["q1", "q3", "q5"]);
  assert.deepEqual(view.normalizeColumnIds(QUESTIONS, ["q8", "q1", "zzz"]), ["q1", "q8"]);
  assert.deepEqual(view.normalizeColumnIds(QUESTIONS, []), ["q1", "q3", "q5"]);
  assert.equal(view.columnHeader(QUESTIONS[1]), "C2 · Ngân sách/tháng");
});

test("answer formatting (detail, table, mobile summary)", () => {
  const [q1, q3, q4, q5] = QUESTIONS;
  assert.equal(view.answerText(q5, 2), "2 / 5 · Không hài lòng");
  assert.equal(view.answerText(q5, 3), "3 / 5 · Bình thường");
  assert.equal(view.answerText(q5, 5), "5 / 5 · Rất hài lòng");
  assert.equal(view.answerText(q3, "1,5–2,5 triệu đồng"), "1,5–2,5 triệu đồng");
  assert.equal(view.answerCompact(q3, "1,5–2,5 triệu đồng"), "1,5–2,5 triệu");
  assert.equal(view.answerCompact(q5, 3), "3/5");
  assert.equal(view.answerCompact(q4, []), "—");
  assert.deepEqual(view.answerChoices(q4, ["Giá thuê", "An ninh"]), ["Giá thuê", "An ninh"]);
  assert.equal(view.responseSummary(DATA.responses[1], [q1, q3, q5]), "Ký túc xá · dưới 1,5 triệu · hài lòng 4/5");
  assert.equal(view.questionKindLabel(q5), "thang 1–5");
  assert.equal(view.questionKindLabel(q1), null);
});

test("durations", () => {
  assert.equal(view.formatDurationShort(348), "5p 48s");
  assert.equal(view.formatDurationShort(425), "7p 05s");
  assert.equal(view.formatDurationShort(45), "45s");
  assert.equal(view.formatDurationLong(362), "6 phút 02 giây");
  assert.equal(view.formatDurationLong(300), "5 phút");
  assert.equal(view.formatSubmittedAt("2026-09-22T14:14:00Z"), "22/09 21:14");
});

test("review reasons are hints", () => {
  assert.equal(messages.reviewReasonText({ code: "TOO_FAST", params: { declaredMinutes: 6 } }), "nhanh hơn nhiều so với 6 phút");
  assert.equal(messages.reviewReasonText({ code: "NEW", params: {} }), "có dấu hiệu cần kiểm tra");
});

// --- Export: table, CSV, file name ---

test("export table: default columns (Figma: 11 columns for 8 questions)", () => {
  const table = exporter.buildExportTable(DATA, exporter.DEFAULT_EXPORT_OPTIONS);
  assert.deepEqual(table.headers.slice(0, 4), ["Mã", "Thời điểm nộp", "Thời gian làm (giây)", "C1. Hiện bạn đang ở đâu?"]);
  assert.equal(table.headers.length, 3 + QUESTIONS.length);
  assert.equal(exporter.exportShape(table), "4 dòng · 8 cột");
  const row = table.rows[3];
  assert.deepEqual(row.slice(0, 3), ["#47AD", "2026-09-18 16:48", 362]);
  assert.equal(row[5], "Giá thuê; An ninh");
  assert.equal(row[6], 2);
});

test("export table: passed only, split choices, quality column", () => {
  const table = exporter.buildExportTable(DATA, {
    ...exporter.DEFAULT_EXPORT_OPTIONS,
    scope: "passed",
    multipleChoice: "split",
    includeSubmittedAt: false,
    includeQuality: true,
  });
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.headers.slice(4, 7), [
    "C3. Yếu tố quan trọng khi chọn chỗ ở? [Giá thuê]",
    "C3. Yếu tố quan trọng khi chọn chỗ ở? [An ninh]",
    "C3. Yếu tố quan trọng khi chọn chỗ ở? [Gần trường]",
  ]);
  assert.deepEqual(table.rows[0].slice(4, 7), [0, 0, 1]);
  assert.equal(table.headers.at(-1), "Chất lượng");
  assert.equal(table.rows[0].at(-1), "Đạt");
});

test("CSV: UTF-8 BOM, CRLF, quoting and formula neutralizing", () => {
  const csv = exporter.toCsv({
    headers: ["Mã", "Ghi chú"],
    rows: [
      ["#A1F2", 'Wifi yếu, "rất" chậm'],
      ["#3C7B", "=HYPERLINK(\"x\")"],
      ["#9E04", "dòng 1\ndòng 2"],
      ["#0E9F", -12],
    ],
  });
  assert.ok(csv.startsWith("﻿Mã,Ghi chú\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[1], '#A1F2,"Wifi yếu, ""rất"" chậm"');
  assert.equal(lines[2], "#3C7B,\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(lines[3], '#9E04,"dòng 1\ndòng 2"');
  assert.equal(lines[4], "#0E9F,-12");
  assert.equal(exporter.csvCell("-1"), "'-1");
  assert.equal(exporter.csvCell("1,5–2,5 triệu"), '"1,5–2,5 triệu"');
  // Vietnamese survives a UTF-8 round trip.
  assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(csv)), csv);
});

test("export file name is an ASCII slug", () => {
  const name = exporter.exportFileName("Nhu cầu nhà trọ gần trường", 1, "csv", new Date("2026-09-27T03:00:00Z"));
  assert.equal(name, "nhu-cau-nha-tro-gan-truong-v1-2026-09-27.csv");
  assert.equal(exporter.exportFileName("Đọc sách!", 2, "xlsx", new Date("2026-09-27T03:00:00Z")), "doc-sach-v2-2026-09-27.xlsx");
});

// --- .xlsx writer ---

test("crc32 and column names", () => {
  assert.equal(xlsx.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.deepEqual([0, 25, 26, 27, 701].map(xlsx.columnName), ["A", "Z", "AA", "AB", "ZZ"]);
  assert.equal(xlsx.xmlEscape('a<b & "c"\u0001'), "a&lt;b &amp; &quot;c&quot;");
});

test("xlsx package is a valid zip with the workbook parts", () => {
  const table = exporter.buildExportTable(DATA, exporter.DEFAULT_EXPORT_OPTIONS);
  const bytes = xlsx.buildXlsx(table);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const sheet = xlsx.sheetXml(table);
  assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">Mã<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="C5"><v>362<\/v><\/c>/);
  let unzip = null;
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    unzip = "unzip";
  } catch {
    // unzip not installed: the structural checks above still ran.
  }
  if (unzip) {
    const dir = mkdtempSync(join(tmpdir(), "rescom-xlsx-"));
    const file = join(dir, "test.xlsx");
    writeFileSync(file, bytes);
    const listing = execFileSync(unzip, ["-t", file]).toString();
    assert.match(listing, /No errors detected/);
    const sheetOut = execFileSync(unzip, ["-p", file, "xl/worksheets/sheet1.xml"]).toString("utf8");
    assert.ok(sheetOut.includes("Nhu") || sheetOut.includes("Hiện bạn đang ở đâu?"));
  }
});

// --- Quality aggregation ---

const QUALITY = {
  versionNumber: 1,
  status: "ENOUGH_DATA",
  confidence: "MEDIUM",
  policyVersion: "survey-quality-v1",
  basedOnResponses: 20,
  minimumResponses: 10,
  updatedAt: null,
  formType: "INTERNAL",
  questionCount: 8,
  started: 23,
  abandoned: 3,
  medianDurationSeconds: 312,
  declaredEffortSeconds: 360,
  technicalErrors: 0,
  feedback: { average: 4.5, count: 8 },
  passed: 18,
  needsReview: 2,
  dropOff: Array.from({ length: 8 }, (_, index) => ({
    questionNumber: index + 1,
    questionType: index === 7 ? "text" : "single_choice",
    required: true,
    count: index === 2 ? 1 : index === 7 ? 2 : 0,
  })),
  suggestions: [],
};

test("quality tiles (Figma 17)", () => {
  const tiles = quality.qualityTiles(QUALITY);
  assert.deepEqual(
    tiles.map((tile) => [tile.value, tile.caption]),
    [
      ["13%", "3 trong 23 người bắt đầu"],
      ["5 phút 12 giây", "Bạn khai 6 phút"],
      ["0", "Không ghi nhận lỗi nào"],
      ["4,5 / 5", "8 đánh giá"],
    ],
  );
  assert.equal(quality.abandonmentRate(0, 0), null);
  assert.equal(quality.confidenceLabel("MEDIUM"), "Độ chắc chắn: trung bình");
});

test("drop-off summary and bars", () => {
  assert.equal(quality.dropOffSummary(QUALITY), "3 người bỏ dở · nhiều nhất ở câu 8 (trả lời ngắn)");
  assert.equal(quality.dropOffSummary({ ...QUALITY, abandoned: 0 }), "Chưa ai bỏ dở giữa chừng");
  const bars = quality.dropOffBars(QUALITY);
  assert.deepEqual(bars.map((bar) => bar.label), ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]);
  assert.equal(quality.peakDropOff(QUALITY).questionNumber, 8);
});

test("suggestion copy", () => {
  const drop = quality.suggestionView({
    code: "DROP_OFF_QUESTION",
    params: { questionNumber: 8, count: 2, questionType: "text", required: true },
    fixedInVersion: 2,
  });
  assert.equal(drop.title, "Câu 8 khiến người trả lời dừng lại");
  assert.equal(drop.body, "2 người thoát ở câu trả lời ngắn bắt buộc. Cân nhắc để câu này không bắt buộc.");
  assert.equal(drop.fixedInVersion, 2);
  const mix = quality.suggestionView({
    code: "RESPONSE_QUALITY",
    params: { passed: 18, needsReview: 2, questionCount: 8, normal: true },
    fixedInVersion: null,
  });
  assert.equal(mix.body, "18 Đạt · 2 Cần xem lại. Tỷ lệ này bình thường với form 8 câu.");
  assert.equal(
    quality.suggestionView({ code: "EFFORT_OVERESTIMATED", params: { medianMinutes: 5 }, fixedInVersion: null }).body,
    "Phần lớn làm xong trong khoảng 5 phút. Có thể khai 5 phút cho lần mở lại.",
  );
});

// --- Version diff labels (Figma 17a) ---

const block = (id, order, title, extra = {}) => ({ id, order, type: "single_choice", title, required: true, ...extra });
const V1 = [
  block("q1", 0, "Hiện bạn đang ở đâu?", { options: [{ label: "Nhà trọ" }] }),
  block("q3", 2, "Ngân sách cho chỗ ở mỗi tháng?", { options: [{ label: "Dưới 1,5 triệu đồng" }] }),
  block("q2", 1, "Chỗ ở cách trường bao xa?"),
  block("q8", 3, "Điều bạn muốn cải thiện nhất?", { type: "text" }),
];

test("diffVersions lists added, changed and removed questions", () => {
  const v2 = [
    block("q1", 0, "Hiện bạn đang ở đâu?", { options: [{ label: "Nhà trọ" }] }),
    block("q2", 1, "Chỗ ở cách trường bao xa?"),
    block("q3", 2, "Ngân sách cho chỗ ở mỗi tháng?", { options: [{ label: "Dưới 1,5 triệu đồng" }, { label: "Trên 5 triệu đồng" }] }),
    block("q8", 3, "Điều bạn muốn cải thiện nhất?", { type: "text", required: false }),
    block("q9", 4, "Bạn sẵn sàng trả thêm bao nhiêu cho phòng có máy lạnh?", { type: "number", required: false }),
  ];
  const changes = versions.diffVersions(V1, v2);
  assert.deepEqual(
    changes.map((change) => `${versions.changeVerb(change.kind)} ${change.detail}`),
    [
      'Thêm câu 5: "Bạn sẵn sàng trả thêm bao nhiêu cho phòng có máy lạnh?"',
      'Sửa câu 3: thêm lựa chọn "Trên 5 triệu đồng"',
      "Sửa câu 4: chuyển thành không bắt buộc",
    ],
  );
  const removed = versions.diffVersions(V1, V1.filter((item) => item.id !== "q2"));
  assert.deepEqual(
    removed.map((change) => `${versions.changeVerb(change.kind)} ${change.detail}`),
    ['Xoá câu 2: "Chỗ ở cách trường bao xa?"'],
  );
  const swapped = versions.diffVersions(V1, [
    { ...V1[0], order: 0 },
    { ...V1[1], order: 1 },
    { ...V1[2], order: 2 },
    { ...V1[3], order: 3 },
  ]);
  assert.deepEqual(
    swapped.map((change) => `${versions.changeVerb(change.kind)} ${change.detail}`),
    ["Sửa câu 2: chuyển từ vị trí câu 3", "Sửa câu 3: chuyển từ vị trí câu 2"],
  );
  assert.deepEqual(versions.diffVersions(V1, V1), []);
});

test("draft/base selection and captions", () => {
  const summaries = [
    { id: "a", formId: "f", versionNumber: 1, isPublished: true, publishedAt: "2026-09-15T01:00:00Z", createdAt: "2026-09-13T13:00:00Z", collectedFrom: "2026-09-15T01:00:00Z", collectedUntil: "2026-09-22T14:14:00Z" },
    { id: "b", formId: "f", versionNumber: 2, isPublished: false, publishedAt: null, createdAt: "2026-09-24T03:00:00Z", updatedAt: "2026-09-26T14:30:00Z", submittedForReviewAt: null },
  ];
  const { draft, base } = versions.draftAndBase(summaries);
  assert.equal(draft.id, "b");
  assert.equal(base.id, "a");
  assert.equal(versions.draftCaption(draft), "Sửa lần cuối 26/09 21:30 · chưa gửi duyệt");
  assert.equal(versions.publishedCaption(base), "Xuất bản 15/09 · thu thập 15/09–22/09");
  assert.deepEqual(versions.draftAndBase([summaries[0]]), { draft: null, base: null });
  assert.equal(versions.qualityStatusLabel("ENOUGH_DATA"), "Đủ dữ liệu");
});
