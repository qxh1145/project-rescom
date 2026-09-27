import { createCollection, hoursAgo } from "../db/store";
import { PUBLISHER_FORM_IDS } from "./forms";

/**
 * Responses and quality snapshots of the publisher surveys (Phase 5C —
 * Figma 10d "Câu trả lời", 17 "Đánh giá chất lượng").
 * "Nhu cầu nhà trọ gần trường": 20 responses on v1; rows 1–10 and #47AD are
 * the Figma content, rows 11–20 plausible (collected on launch day).
 * "Thói quen đọc sách": 6 Google Forms responses — only the verified
 * completion code lives in Rescom, the answers stay in Google Forms.
 */

export type MockAnswer = string | number | string[] | null;

export interface MockFormResponse {
  id: string;
  formId: string;
  versionNumber: number;
  code: string;
  submittedAt: string;
  durationSeconds: number;
  quality: "PASSED" | "NEEDS_REVIEW";
  reviewReasons: Array<{ code: string; params: Record<string, string | number> }>;
  answers: Record<string, MockAnswer>;
  codeVerified: boolean | null;
}

const HOUSING = PUBLISHER_FORM_IDS.housingNearCampus;
const READING = PUBLISHER_FORM_IDS.readingHabits;

const Q1 = { tro: "Nhà trọ", ktx: "Ký túc xá", nguoiThan: "Nhà người thân", rieng: "Nhà riêng" };
const Q2 = { duoi1: "Dưới 1 km", k13: "1–3 km", k35: "3–5 km", tren5: "Trên 5 km" };
const Q3 = {
  duoi15: "Dưới 1,5 triệu đồng",
  t1525: "1,5–2,5 triệu đồng",
  t2535: "2,5–3,5 triệu đồng",
  tren35: "Trên 3,5 triệu đồng",
};
const Q6 = { co: "Có", khong: "Không", tuy: "Tuỳ người ở ghép" };

type HousingRow = [
  code: string,
  submittedAt: string,
  seconds: number,
  q1: string,
  q2: string,
  q3: string,
  q4: string[],
  q5: number,
  q6: string,
  q7: string[],
  q8: string,
  review?: boolean,
];

const HOUSING_ROWS: HousingRow[] = [
  ["A1F2", "2026-09-22T21:14", 348, Q1.tro, Q2.k13, Q3.t1525, ["Giá thuê", "Gần trường"], 3, Q6.co, ["Nhóm Facebook"], "Wifi yếu vào buổi tối."],
  ["3C7B", "2026-09-22T19:02", 390, Q1.ktx, Q2.duoi1, Q3.duoi15, ["Giá thuê"], 4, Q6.khong, ["Bảng tin trường"], "Phòng hơi chật, muốn có thêm chỗ để đồ."],
  ["9E04", "2026-09-21T22:47", 295, Q1.tro, Q2.k35, Q3.t2535, ["An ninh", "Tiện nghi"], 2, Q6.tuy, ["Ứng dụng, website"], "Xa trường, đi lại mất nhiều thời gian."],
  ["6B1C", "2026-09-21T13:20", 118, Q1.tro, Q2.k13, Q3.t1525, ["Giá thuê"], 5, Q6.co, ["Nhóm Facebook"], "không", true],
  ["D58A", "2026-09-20T20:11", 425, Q1.nguoiThan, Q2.tren5, Q3.t1525, ["Gần trường", "An ninh"], 4, Q6.khong, ["Người quen"], "Muốn ở gần trường hơn để đỡ thời gian đi lại."],
  ["F20E", "2026-09-19T09:36", 320, Q1.tro, Q2.duoi1, Q3.tren35, ["Tiện nghi", "An ninh"], 3, Q6.tuy, ["Ứng dụng, website", "Nhóm Facebook"], "Giá điện nước cao hơn giá nhà nước."],
  ["47AD", "2026-09-18T16:48", 362, Q1.tro, Q2.k13, Q3.t1525, ["Giá thuê", "An ninh", "Gần trường"], 2, Q6.tuy, ["Nhóm Facebook", "Người quen"], "Phòng hay bị ẩm, buổi tối thường mất nước, chủ trọ xử lý chậm."],
  ["B8C3", "2026-09-17T11:05", 341, Q1.ktx, Q2.duoi1, Q3.duoi15, ["Giá thuê", "Gần trường"], 4, Q6.co, ["Bảng tin trường"], "Giờ giới nghiêm hơi sớm."],
  ["0E9F", "2026-09-16T20:30", 130, Q1.tro, Q2.k13, Q3.t2535, ["An ninh"], 3, Q6.co, ["Nhóm Facebook"], "ok", true],
  ["5D26", "2026-09-15T18:22", 404, Q1.tro, Q2.k35, Q3.t1525, ["Giá thuê", "Tiện nghi"], 3, Q6.khong, ["Người quen"], "Hàng xóm ồn ào vào ban đêm."],
  ["C41B", "2026-09-15T17:40", 305, Q1.tro, Q2.k13, Q3.t1525, ["Giá thuê", "An ninh"], 3, Q6.co, ["Nhóm Facebook"], "Muốn có chỗ để xe rộng hơn."],
  ["7F3A", "2026-09-15T16:12", 287, Q1.ktx, Q2.duoi1, Q3.duoi15, ["Giá thuê"], 4, Q6.co, ["Bảng tin trường"], "Nhà vệ sinh chung hay bị tắc."],
  ["E2D9", "2026-09-15T15:03", 336, Q1.tro, Q2.k35, Q3.t2535, ["Tiện nghi", "Gần trường"], 2, Q6.tuy, ["Ứng dụng, website"], "Tiền cọc quá cao so với thu nhập sinh viên."],
  ["2B8E", "2026-09-15T14:26", 312, Q1.rieng, Q2.tren5, Q3.tren35, ["Tiện nghi"], 4, Q6.khong, ["Người quen"], "Đường về nhà buổi tối thiếu đèn."],
  ["91C0", "2026-09-15T13:18", 298, Q1.tro, Q2.k13, Q3.t1525, ["Giá thuê", "Chủ trọ dễ tính"], 3, Q6.co, ["Nhóm Facebook", "Người quen"], "Chủ trọ hay tăng giá giữa kỳ."],
  ["A7E5", "2026-09-15T11:47", 276, Q1.nguoiThan, Q2.k35, Q3.duoi15, ["Gần trường"], 4, Q6.khong, ["Người quen"], "Không có chỗ học yên tĩnh."],
  ["5C62", "2026-09-15T10:55", 331, Q1.tro, Q2.duoi1, Q3.t2535, ["An ninh", "Tiện nghi"], 3, Q6.tuy, ["Ứng dụng, website"], "Muốn có máy giặt chung."],
  ["D0F4", "2026-09-15T09:40", 319, Q1.ktx, Q2.duoi1, Q3.duoi15, ["Giá thuê", "Gần trường"], 4, Q6.co, ["Bảng tin trường"], "Phòng ở 8 người hơi đông."],
  ["8A1D", "2026-09-15T08:52", 360, Q1.tro, Q2.k13, Q3.t1525, ["Giá thuê", "An ninh", "Chủ trọ dễ tính"], 3, Q6.tuy, ["Nhóm Facebook"], "Mạng internet chập chờn khi mưa."],
  ["4E7C", "2026-09-15T08:21", 334, Q1.tro, Q2.k35, Q3.t2535, ["Tiện nghi"], 2, Q6.khong, ["Ứng dụng, website", "Bảng tin trường"], "Phòng nóng vào mùa hè, không có máy lạnh."],
];

const uuid = (prefix: string, index: number) => `${prefix}${String(index + 1).padStart(12, "0")}`;

function housingResponses(): MockFormResponse[] {
  return HOUSING_ROWS.map(([code, at, seconds, q1, q2, q3, q4, q5, q6, q7, q8, review], index) => ({
    id: uuid("9f3a5b70-2c4d-4e5f-8a6b-", index),
    formId: HOUSING,
    versionNumber: 1,
    code,
    submittedAt: `${at}:00+07:00`,
    durationSeconds: seconds,
    quality: review ? "NEEDS_REVIEW" : "PASSED",
    reviewReasons: review ? [{ code: "TOO_FAST", params: { declaredMinutes: 6 } }] : [],
    answers: {
      "house-q1": q1,
      "house-q2": q2,
      "house-q3": q3,
      "house-q4": q4,
      "house-q5": q5,
      "house-q6": q6,
      "house-q7": q7,
      "house-q8": q8,
    },
    codeVerified: null,
  }));
}

const READING_ROWS: Array<[code: string, hours: number, seconds: number]> = [
  ["R5A2", 5, 452],
  ["R19C", 20, 498],
  ["RB07", 31, 405],
  ["R6E3", 49, 530],
  ["RD41", 70, 441],
  ["R8F6", 90, 476],
];

function readingResponses(): MockFormResponse[] {
  return READING_ROWS.map(([code, hours, seconds], index) => ({
    id: uuid("9f3a5b70-2c4d-4e5f-8b6c-", index),
    formId: READING,
    versionNumber: 1,
    code,
    submittedAt: hoursAgo(hours),
    durationSeconds: seconds,
    quality: "PASSED",
    reviewReasons: [],
    answers: {},
    codeVerified: true,
  }));
}

export const formResponses = createCollection<MockFormResponse[]>("form-responses", () => [
  ...housingResponses(),
  ...readingResponses(),
]);

/** Newest first. */
export function responsesOf(formId: string, versionNumber: number): MockFormResponse[] {
  return formResponses
    .get()
    .filter((response) => response.formId === formId && response.versionNumber === versionNumber)
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
}

/** Versions of a form that received responses, newest first. */
export function versionsWithResponses(formId: string): number[] {
  const numbers = new Set(formResponses.get().filter((row) => row.formId === formId).map((row) => row.versionNumber));
  return [...numbers].sort((a, b) => b - a);
}

/**
 * Figma 17 numbers for housing v1 (bỏ dở 3/23, trung vị 5 phút 12 giây,
 * 0 lỗi, 4,5/5 · 8 đánh giá, drop-off C3 ×1 and C8 ×2). Other forms/versions
 * are derived by the handler.
 */
export interface MockQualitySnapshot {
  formId: string;
  versionNumber: number;
  started: number;
  abandoned: number;
  medianDurationSeconds: number | null;
  technicalErrors: number;
  feedback: { average: number | null; count: number };
  dropOffByQuestion: Record<number, number>;
  answerChangesQuestion: number | null;
  updatedAt: string;
}

export const QUALITY_SNAPSHOTS: MockQualitySnapshot[] = [
  {
    formId: HOUSING,
    versionNumber: 1,
    started: 23,
    abandoned: 3,
    medianDurationSeconds: 312,
    technicalErrors: 0,
    feedback: { average: 4.5, count: 8 },
    dropOffByQuestion: { 3: 1, 8: 2 },
    answerChangesQuestion: 4,
    updatedAt: "2026-09-22T22:00:00+07:00",
  },
  {
    formId: READING,
    versionNumber: 1,
    started: 7,
    abandoned: 1,
    medianDurationSeconds: 464,
    technicalErrors: 0,
    feedback: { average: 4, count: 3 },
    dropOffByQuestion: {},
    answerChangesQuestion: null,
    updatedAt: hoursAgo(5),
  },
];

/** Policy `survey-quality-v1` (ASSUMED): a verdict needs this many responses. */
export const QUALITY_MINIMUM_RESPONSES = 10;
