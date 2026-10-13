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
const service = await import("../lib/forms/results-service.ts");
const { publisherResponsesPageSchema } = await import("@rescom/schemas");
const { ApiError } = await import("../lib/api/api-error.ts");

// --- Fixture: "Nhu cầu nhà trọ gần trường" (Figma 10d), 5 questions (Story IR.4a page shape) ---

const opts = (...labels) => labels.map((label) => ({ value: label, label }));
const QUESTIONS = [
  { id: "q1", number: 1, title: "Hiện bạn đang ở đâu?", type: "single_choice", required: true, options: opts("Nhà trọ", "Ký túc xá", "Nhà người thân"), allowOther: false, scale: null },
  { id: "q3", number: 2, title: "Ngân sách cho chỗ ở mỗi tháng?", type: "single_choice", required: true, options: opts("Dưới 1,5 triệu đồng", "1,5–2,5 triệu đồng"), allowOther: false, scale: null },
  { id: "q4", number: 3, title: "Yếu tố quan trọng khi chọn chỗ ở?", type: "multiple_choice", required: true, options: opts("Giá thuê", "An ninh", "Gần trường"), allowOther: false, scale: null },
  { id: "q5", number: 4, title: "Mức hài lòng", type: "linear_scale", required: true, options: [], allowOther: false, scale: { min: 1, max: 5, minLabel: "Rất không hài lòng", maxLabel: "Rất hài lòng" } },
  { id: "q8", number: 5, title: "Điều bạn muốn cải thiện nhất?", type: "text", required: true, options: [], allowOther: false, scale: null },
];
const VERSION_ID = "0b8c3c3e-5f43-4a43-9a51-6f1f1d2b0a01";

function response(code, overrides = {}) {
  return {
    id: `00000000-0000-4000-8000-${code.padStart(12, "0")}`,
    code,
    formVersionId: VERSION_ID,
    submittedAt: "2026-09-18T16:48:00+07:00",
    durationSeconds: 362,
    integrity: { applicability: "NOT_ASSESSED" },
    answers: { q1: "Nhà trọ", q3: "1,5–2,5 triệu đồng", q4: ["Giá thuê", "An ninh"], q5: 2, q8: "Phòng hay bị ẩm" },
    ...overrides,
  };
}

const PAGE = publisherResponsesPageSchema.parse({
  availability: "AVAILABLE",
  form: { id: "5b1d7c2e-3f4a-4b6c-8d9e-0f1a2b3c4d01", title: "Nhu cầu nhà trọ gần trường", type: "INTERNAL", versionId: VERSION_ID, versionNumber: 1 },
  questions: QUESTIONS,
  responses: [
    response("A1F2", { submittedAt: "2026-09-22T21:14:00+07:00", durationSeconds: 348, answers: { q1: "Nhà trọ", q3: "1,5–2,5 triệu đồng", q4: ["Gần trường"], q5: 3, q8: 'Wifi yếu, "rất" chậm' } }),
    response("3C7B", { answers: { q1: "Ký túc xá", q3: "Dưới 1,5 triệu đồng", q4: [], q5: 4, q8: "=HYPERLINK(\"x\")" } }),
    response("6B1C", { durationSeconds: null }),
    response("47AD"),
  ],
  totalCount: 4,
  nextCursor: null,
});
const DATA = { ...PAGE, truncated: false };

// --- Collecting the cursor pages (AC8.1) ---

function pagedFetcher(rows, size) {
  const calls = [];
  const fetchPage = async (cursor) => {
    calls.push(cursor);
    const start = cursor ? Number(cursor) : 0;
    const slice = rows.slice(start, start + size);
    const next = start + size < rows.length ? String(start + size) : null;
    return { ...PAGE, responses: slice, totalCount: rows.length, nextCursor: next };
  };
  return { fetchPage, calls };
}

test("collectResponsePages follows the cursor, de-duplicates by id and reports truncation", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => response(`B${index}`));
  rows.splice(4, 0, rows[3]); // a row seen twice (shifted between pages)
  const { fetchPage, calls } = pagedFetcher(rows, 3);
  const all = await service.collectResponsePages(fetchPage);
  assert.equal(all.responses.length, 7);
  assert.equal(new Set(all.responses.map((row) => row.id)).size, 7);
  assert.equal(all.truncated, false);
  assert.equal(all.nextCursor, null);
  assert.deepEqual(calls, [null, "3", "6"]);

  const many = Array.from({ length: service.RESPONSES_MAX_PAGES * 2 + 1 }, (_, index) => response(`C${index}`));
  const capped = await service.collectResponsePages(pagedFetcher(many, 1).fetchPage);
  assert.equal(capped.responses.length, service.RESPONSES_MAX_PAGES);
  assert.equal(capped.truncated, true);
});

test("collectResponsePages pins the first page's version on every following page", async () => {
  // Page 1 is v1 (the server's pick); a v2 response arriving mid-walk must not switch the walk.
  const requested = [];
  const v2 = { ...PAGE.form, versionId: "0b8c3c3e-5f43-4a43-9a51-6f1f1d2b0a02", versionNumber: 2 };
  const fetchPage = async (cursor, versionNumber) => {
    requested.push([cursor, versionNumber]);
    if (cursor === null) return { ...PAGE, responses: [response("D1")], nextCursor: "c1" };
    // Unpinned, the server would now pick v2: answer with v2 then.
    if (versionNumber === null) return { ...PAGE, form: v2, responses: [response("E1")], nextCursor: null };
    return { ...PAGE, responses: [response("D2")], nextCursor: null };
  };
  const all = await service.collectResponsePages(fetchPage);
  assert.deepEqual(requested, [[null, null], ["c1", 1]]);
  assert.deepEqual(all.responses.map((row) => row.code), ["D1", "D2"]);
  // A page of another version is never mixed in.
  const switched = await service.collectResponsePages(async (cursor) =>
    cursor === null ? { ...PAGE, responses: [response("F1")], nextCursor: "c1" } : { ...PAGE, form: v2, responses: [response("F2")], nextCursor: null },
  );
  assert.deepEqual(switched.responses.map((row) => row.code), ["F1"]);
});

test("collectResponsePages passes NOT_APPLICABLE through (Google Forms)", async () => {
  const notApplicable = {
    availability: "NOT_APPLICABLE",
    reason: "EXTERNAL_FORM",
    form: { id: "f2", title: "Đọc sách", type: "EXTERNAL", externalUrl: "https://docs.google.com/forms/d/e/x/viewform" },
  };
  let calls = 0;
  const result = await service.collectResponsePages(async () => (calls++, notApplicable));
  assert.deepEqual(result, { ...notApplicable, truncated: false });
  assert.equal(calls, 1);
});

// --- View: search, pagination, position ---

test("filter is search-only (no quality filter: responses are never graded)", () => {
  assert.equal(view.filterResponses(DATA.responses, QUESTIONS, { query: "" }).length, 4);
  assert.equal("qualityCounts" in view, false);
  assert.equal("parseQualityFilter" in view, false);
});

test("search matches code with or without # and answers without diacritics", () => {
  const find = (query) => view.filterResponses(DATA.responses, QUESTIONS, { query }).map((r) => r.code);
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

test("position gives previous (newer) and next (older) over the collected list", () => {
  const position = view.responsePosition(DATA.responses, DATA.responses[1].id);
  assert.equal(position.index, 2);
  assert.equal(position.total, 4);
  assert.equal(position.previous.code, "A1F2");
  assert.equal(position.next.code, "6B1C");
  assert.equal(view.responsePosition(DATA.responses, "missing"), null);
});

test("default columns are the first questions; headers use the title (no short labels)", () => {
  assert.deepEqual(view.defaultColumnIds(QUESTIONS), ["q1", "q3", "q4"]);
  assert.deepEqual(view.normalizeColumnIds(QUESTIONS, ["q8", "q1", "zzz"]), ["q1", "q8"]);
  assert.deepEqual(view.normalizeColumnIds(QUESTIONS, []), ["q1", "q3", "q4"]);
  assert.equal(view.columnHeader(QUESTIONS[1]), "C2 · Ngân sách cho chỗ ở mỗi tháng?");
});

test("answer formatting (detail, table, mobile summary)", () => {
  const [q1, q3, q4, q5] = QUESTIONS;
  assert.equal(view.answerText(q5, 2), "2 / 5 · Không hài lòng");
  assert.equal(view.answerText(q5, 3), "3 / 5 · Bình thường");
  assert.equal(view.answerText(q5, 5), "5 / 5 · Rất hài lòng");
  assert.equal(view.answerText(q3, "1,5–2,5 triệu đồng"), "1,5–2,5 triệu đồng");
  assert.equal(view.answerCompact(q3, "1,5–2,5 triệu đồng"), "1,5–2,5 triệu");
  assert.equal(view.answerCompact(q5, 3), "3/5");
  assert.equal(view.answerCompact(q4, []), "Chưa có");
  assert.deepEqual(view.answerChoices(q4, ["Giá thuê", "An ninh"]), ["Giá thuê", "An ninh"]);
  assert.equal(view.responseSummary(DATA.responses[1], [q1, q3, q5]), "Ký túc xá · dưới 1,5 triệu · mức hài lòng 4/5");
  assert.equal(view.questionKindLabel(q5), "thang 1 đến 5");
  assert.equal(view.questionKindLabel(q1), null);
});

test("durations, including an unknown (null) one", () => {
  assert.equal(view.formatDurationShort(348), "5p 48s");
  assert.equal(view.formatDurationShort(425), "7p 05s");
  assert.equal(view.formatDurationShort(45), "45s");
  assert.equal(view.formatDurationShort(null), "Chưa có");
  assert.equal(view.formatDurationLong(362), "6 phút 02 giây");
  assert.equal(view.formatDurationLong(300), "5 phút");
  assert.equal(view.formatDurationLong(null), "Chưa có");
  assert.equal(view.formatSubmittedAt("2026-09-22T14:14:00Z"), "22/09 21:14");
});

test("load errors: a missing route (bare 404) never says the survey was deleted", () => {
  const error = (status, code) => new ApiError({ kind: "http", status, code, message: code ?? "x" });
  assert.match(messages.responsesLoadErrorMessage(error(404, "FORM_NOT_FOUND")), /Không tìm thấy khảo sát này/);
  const missingRoute = messages.responsesLoadErrorMessage(error(404, "NOT_FOUND"));
  assert.doesNotMatch(missingRoute, /xoá/);
  assert.match(missingRoute, /chưa hỗ trợ/);
  assert.equal(messages.responsesLoadErrorMessage(error(404, "FORM_VERSION_NOT_FOUND")), "Không có phiên bản này của khảo sát.");
  assert.match(messages.responsesLoadErrorMessage(error(400, "INVALID_CURSOR")), /Tải lại trang/);
  assert.match(messages.analyticsLoadErrorMessage(error(422, "PUBLISHER_ANALYTICS_LIMIT_EXCEEDED")), /hơn 5\.000 câu trả lời.*chỉ 2\.000 câu trả lời mới nhất/);
  assert.equal(messages.RESPONSES_TRUNCATED_NOTE, "Chỉ hiển thị 2.000 câu trả lời mới nhất.");
});

// --- Export: table, CSV, file name ---

test("export table: default columns (code, time, duration + one column per question)", () => {
  const table = exporter.buildExportTable(DATA, exporter.DEFAULT_EXPORT_OPTIONS);
  assert.deepEqual(table.headers.slice(0, 4), ["Mã", "Thời điểm nộp", "Thời gian làm (giây)", "C1. Hiện bạn đang ở đâu?"]);
  assert.equal(table.headers.length, 3 + QUESTIONS.length);
  assert.equal(exporter.exportShape(table), "4 dòng · 8 cột");
  const row = table.rows[3];
  assert.deepEqual(row.slice(0, 3), ["#47AD", "2026-09-18 16:48", 362]);
  assert.equal(row[5], "Giá thuê; An ninh");
  assert.equal(row[6], 2);
  // An unknown duration is an empty cell; no quality option exists any more.
  assert.equal(table.rows[2][2], "");
  assert.equal("includeQuality" in exporter.DEFAULT_EXPORT_OPTIONS, false);
  assert.equal("scope" in exporter.DEFAULT_EXPORT_OPTIONS, false);
});

test("export table: split choices", () => {
  const table = exporter.buildExportTable(DATA, {
    ...exporter.DEFAULT_EXPORT_OPTIONS,
    multipleChoice: "split",
    includeSubmittedAt: false,
  });
  assert.equal(table.rows.length, 4);
  assert.deepEqual(table.headers.slice(4, 7), [
    "C3. Yếu tố quan trọng khi chọn chỗ ở? [Giá thuê]",
    "C3. Yếu tố quan trọng khi chọn chỗ ở? [An ninh]",
    "C3. Yếu tố quan trọng khi chọn chỗ ở? [Gần trường]",
  ]);
  assert.deepEqual(table.rows[0].slice(4, 7), [0, 0, 1]);
});

test("Phase 5 M4: split choices keep a \"Khác\" answer in its own column when the question allows it", () => {
  const withOther = QUESTIONS.map((question) => (question.id === "q4" ? { ...question, allowOther: true } : question));
  const data = {
    ...DATA,
    questions: withOther,
    responses: [response("0A01", { answers: { q4: ["Giá thuê", "Có chỗ để xe"] } }), response("0A02", { answers: { q4: ["An ninh"] } })],
  };
  const table = exporter.buildExportTable(data, {
    ...exporter.DEFAULT_EXPORT_OPTIONS,
    multipleChoice: "split",
    includeSubmittedAt: false,
    includeDuration: false,
  });
  const other = table.headers.indexOf("C3. Yếu tố quan trọng khi chọn chỗ ở? [Khác]");
  assert.ok(other > 0);
  assert.equal(table.headers[other - 1], "C3. Yếu tố quan trọng khi chọn chỗ ở? [Gần trường]");
  assert.deepEqual(table.rows[0].slice(other - 3, other + 1), [1, 0, 0, "Có chỗ để xe"]);
  assert.equal(table.rows[1][other], "");
  // Without allowOther there is no extra column; the joined layout already keeps the text.
  const plain = exporter.buildExportTable({ ...data, questions: QUESTIONS }, { ...exporter.DEFAULT_EXPORT_OPTIONS, multipleChoice: "split" });
  assert.equal(plain.headers.some((header) => header.endsWith("[Khác]")), false);
  const joined = exporter.buildExportTable(data, { ...exporter.DEFAULT_EXPORT_OPTIONS, includeSubmittedAt: false, includeDuration: false });
  assert.ok(joined.rows[0].includes("Giá thuê; Có chỗ để xe"));
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
    { id: "a", formId: "f", versionNumber: 1, isPublished: true, publishedAt: "2026-09-15T01:00:00Z", createdAt: "2026-09-13T13:00:00Z" },
    { id: "b", formId: "f", versionNumber: 2, isPublished: false, publishedAt: null, createdAt: "2026-09-24T03:00:00Z" },
  ];
  const { draft, base } = versions.draftAndBase(summaries);
  assert.equal(draft.id, "b");
  assert.equal(base.id, "a");
  assert.equal(versions.draftCaption(draft), "Tạo 24/09 10:00");
  assert.equal(versions.publishedCaption(base), "Xuất bản 15/09");
  assert.deepEqual(versions.draftAndBase([summaries[0]]), { draft: null, base: null });
});
