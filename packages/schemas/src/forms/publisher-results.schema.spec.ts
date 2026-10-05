import { readFileSync } from "fs";
import { join } from "path";
import {
  countIntoProgressWindow,
  decodePublisherResponsesCursor,
  encodePublisherResponsesCursor,
  formRejectionSchema,
  publisherAnalyticsQuerySchema,
  publisherAnalyticsSchema,
  publisherFormVersionDetailSchema,
  publisherProgressQuerySchema,
  publisherProgressSchema,
  publisherProgressWindow,
  publisherResponseRowSchema,
  publisherResponsesPageSchema,
  publisherResponsesQuerySchema,
  toCompletionsSeries,
  toPublisherQuestions,
  projectPublisherAnswers,
  PUBLISHER_RESPONSES_PAGE_LIMIT_DEFAULT,
} from "./index";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(__dirname, "__fixtures__", "publisher-results", `${name}.json`), "utf8"),
  );

describe("IR.4a golden fixtures (contract test, schemas half)", () => {
  it("parses every fixture with its schema", () => {
    expect(publisherProgressSchema.parse(fixture("progress")).completionsSeries.total).toBe(12);
    const page1 = publisherResponsesPageSchema.parse(fixture("responses-page-1"));
    const page2 = publisherResponsesPageSchema.parse(fixture("responses-page-2"));
    expect(page1.availability).toBe("AVAILABLE");
    expect(page2.availability === "AVAILABLE" && page2.nextCursor).toBeNull();
    expect(publisherResponsesPageSchema.parse(fixture("responses-not-applicable")).availability).toBe(
      "NOT_APPLICABLE",
    );
    expect(publisherAnalyticsSchema.parse(fixture("analytics")).availability).toBe("AVAILABLE");
    expect(publisherFormVersionDetailSchema.parse(fixture("version-detail")).versionNumber).toBe(2);
  });

  it("page 1's cursor points at its last row of the same version", () => {
    const page1 = publisherResponsesPageSchema.parse(fixture("responses-page-1"));
    if (page1.availability !== "AVAILABLE" || !page1.nextCursor) throw new Error("fixture");
    const last = page1.responses[page1.responses.length - 1];
    expect(decodePublisherResponsesCursor(page1.nextCursor)).toEqual({
      v: 1,
      versionId: page1.form.versionId,
      submittedAt: last.submittedAt,
      id: last.id,
    });
  });
});

describe("privacy strictness (AD-18)", () => {
  const row = () => {
    const page = fixture("responses-page-1") as { responses: Record<string, unknown>[] };
    return { ...page.responses[0] };
  };

  it.each(["respondentId", "attemptId", "quality", "ipAddress"])("rejects a row with %s", (key) => {
    expect(publisherResponseRowSchema.safeParse({ ...row(), [key]: "x" }).success).toBe(false);
  });

  it("enforces the integrity literal and accepts a null duration", () => {
    expect(
      publisherResponseRowSchema.safeParse({ ...row(), integrity: { applicability: "ASSESSED" } }).success,
    ).toBe(false);
    expect(publisherResponseRowSchema.safeParse({ ...row(), durationSeconds: null }).success).toBe(true);
  });

  it("rejects a version detail that leaks completionCode or targetingJson", () => {
    const detail = fixture("version-detail") as Record<string, unknown>;
    expect(publisherFormVersionDetailSchema.safeParse({ ...detail, completionCode: "ABC" }).success).toBe(false);
    expect(publisherFormVersionDetailSchema.safeParse({ ...detail, targetingJson: null }).success).toBe(false);
  });

  it("discriminates on availability (no rows on NOT_APPLICABLE)", () => {
    const na = fixture("responses-not-applicable") as Record<string, unknown>;
    expect(publisherResponsesPageSchema.safeParse({ ...na, responses: [] }).success).toBe(false);
    expect(publisherResponsesPageSchema.safeParse({ ...na, availability: "MAYBE" }).success).toBe(false);
  });
});

describe("query schemas", () => {
  it("progress range defaults to day and rejects unknown values", () => {
    expect(publisherProgressQuerySchema.parse({})).toEqual({ range: "day" });
    expect(publisherProgressQuerySchema.safeParse({ range: "year" }).success).toBe(false);
    expect(publisherProgressQuerySchema.safeParse({ range: "day", extra: "1" }).success).toBe(false);
  });

  it("responses limit is 1..100 (default 50) and versionNumber a positive int", () => {
    expect(publisherResponsesQuerySchema.parse({}).limit).toBe(PUBLISHER_RESPONSES_PAGE_LIMIT_DEFAULT);
    expect(publisherResponsesQuerySchema.parse({ limit: "100", versionNumber: "2" })).toEqual({
      limit: 100,
      versionNumber: 2,
    });
    for (const limit of ["0", "101", "1.5", "x"]) {
      expect(publisherResponsesQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(publisherResponsesQuerySchema.safeParse({ versionNumber: "0" }).success).toBe(false);
    expect(publisherAnalyticsQuerySchema.safeParse({ versionNumber: "-1" }).success).toBe(false);
    expect(publisherAnalyticsQuerySchema.safeParse({ cursor: "x" }).success).toBe(false);
  });
});

describe("responses cursor", () => {
  const cursor = {
    versionId: "0b8c3c3e-5f43-4a43-9a51-6f1f1d2b0a02",
    submittedAt: "2026-09-29T08:15:00.000Z",
    id: "6a1f0e57-91b6-4c0f-8f0e-3d1c2b4a5e02",
  };

  it("round-trips", () => {
    expect(decodePublisherResponsesCursor(encodePublisherResponsesCursor(cursor))).toEqual({ v: 1, ...cursor });
  });

  it("rejects a well-formed token whose ids are not UUIDs (forged cursor)", () => {
    expect(decodePublisherResponsesCursor(encodePublisherResponsesCursor({ ...cursor, id: "x' OR 1=1" }))).toBeNull();
    expect(decodePublisherResponsesCursor(encodePublisherResponsesCursor({ ...cursor, versionId: "v1" }))).toBeNull();
  });

  it("rejects garbage, a wrong version tag and a non-ISO instant", () => {
    expect(decodePublisherResponsesCursor("!!!")).toBeNull();
    expect(decodePublisherResponsesCursor("e30")).toBeNull(); // "{}"
    const wrongV = encodePublisherResponsesCursor(cursor).replace(/^eyJ2IjoxL/, "eyJ2IjoyL");
    expect(decodePublisherResponsesCursor(wrongV)).toBeNull();
    expect(
      decodePublisherResponsesCursor(encodePublisherResponsesCursor({ ...cursor, submittedAt: "yesterday" })),
    ).toBeNull();
  });
});

describe("publisherProgressWindow (Asia/Ho_Chi_Minh)", () => {
  const BEFORE = new Date("2026-09-30T16:59:59Z"); // 23:59:59 local, Wed 30/09
  const AT = new Date("2026-09-30T17:00:00Z"); // 00:00 local, Thu 01/10

  const starts = (range: "hour" | "day" | "week" | "month", now: Date) =>
    publisherProgressWindow(range, now).map((bucket) => bucket.startsAt.toISOString());

  it("hour: 8 × 3 h aligned to local 3-hour boundaries, last bucket contains now", () => {
    const window = publisherProgressWindow("hour", BEFORE);
    expect(window).toHaveLength(8);
    expect(window[7].startsAt.toISOString()).toBe("2026-09-30T14:00:00.000Z"); // 21h local
    expect(publisherProgressWindow("hour", AT)[7].startsAt.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(window[7].endsAt.getTime()).toBeGreaterThan(BEFORE.getTime());
  });

  it("day: 7 local days ending today, flips at local midnight", () => {
    expect(starts("day", BEFORE)[6]).toBe("2026-09-29T17:00:00.000Z");
    expect(starts("day", AT)[6]).toBe("2026-09-30T17:00:00.000Z");
    expect(starts("day", AT)[0]).toBe("2026-09-24T17:00:00.000Z");
  });

  it("week: 4 ISO weeks (Monday start); a week can span a month boundary", () => {
    expect(starts("week", BEFORE)).toEqual([
      "2026-09-06T17:00:00.000Z",
      "2026-09-13T17:00:00.000Z",
      "2026-09-20T17:00:00.000Z",
      "2026-09-27T17:00:00.000Z", // Mon 28/09 local, contains Thu 01/10
    ]);
    expect(starts("week", AT)[3]).toBe("2026-09-27T17:00:00.000Z");
  });

  it("month: 6 calendar months, flips at local midnight of the 1st, rolls over the year", () => {
    expect(starts("month", BEFORE)[5]).toBe("2026-08-31T17:00:00.000Z");
    expect(starts("month", AT)[5]).toBe("2026-09-30T17:00:00.000Z");
    expect(starts("month", new Date("2027-01-15T00:00:00Z"))).toEqual([
      "2026-07-31T17:00:00.000Z",
      "2026-08-31T17:00:00.000Z",
      "2026-09-30T17:00:00.000Z",
      "2026-10-31T17:00:00.000Z",
      "2026-11-30T17:00:00.000Z",
      "2026-12-31T17:00:00.000Z",
    ]);
  });

  it("counts instants into half-open buckets and builds a zero-filled series", () => {
    const window = publisherProgressWindow("day", AT);
    const counts = countIntoProgressWindow(window, [
      new Date("2026-09-30T16:59:59.999Z"),
      new Date("2026-09-30T17:00:00Z"),
      new Date("2026-01-01T00:00:00Z"),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 1, 1]);
    const series = toCompletionsSeries("day", window, counts);
    expect(series.total).toBe(2);
    expect(series.timeZone).toBe("Asia/Ho_Chi_Minh");
    expect(series.buckets[6]).toEqual({ startsAt: "2026-09-30T17:00:00.000Z", endsAt: "2026-10-01T17:00:00.000Z", count: 1 });
  });
});

describe("toPublisherQuestions", () => {
  it("sorts by order, numbers from 1 and projects options, Khác and scales", () => {
    const questions = toPublisherQuestions([
      { id: "b", type: "rating", order: 2, title: "Sao", required: true, maxRating: 7 },
      { id: "a", type: "single_choice", order: 1, title: "Chọn", allowOther: true, options: [{ id: "o", value: "v", label: "L" }] },
      { id: "c", type: "linear_scale", order: 3, title: "Thang", min: 0, max: 4, minLabel: "Thấp" },
      { id: "x", type: "unknown", order: 0 },
      { type: "text", order: 0 },
      null,
    ]);
    expect(questions.map((question) => [question.id, question.number])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(questions[0]).toMatchObject({ options: [{ value: "v", label: "L" }], allowOther: true, scale: null });
    expect(questions[1].scale).toEqual({ min: 1, max: 7, minLabel: null, maxLabel: null });
    expect(questions[2].scale).toEqual({ min: 0, max: 4, minLabel: "Thấp", maxLabel: null });
    expect(questions[2].required).toBe(false);
  });
});

describe("projectPublisherAnswers", () => {
  it("keeps known keys only, file names, booleans as text; drops the rest", () => {
    const questions = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "f" }, { id: "n" }];
    expect(
      projectPublisherAnswers(
        {
          a: "x",
          b: true,
          c: Number.NaN,
          f: [{ objectId: "obj-1", fileName: "cv.pdf" }, { objectId: "obj-2" }],
          n: { nested: 1 },
          stale: "dropped",
        },
        questions,
      ),
    ).toEqual({ a: "x", b: "true", f: ["cv.pdf"] });
    expect(projectPublisherAnswers(null, questions)).toEqual({});
    expect(projectPublisherAnswers(["x"], questions)).toEqual({});
  });
});

describe("formRejectionSchema", () => {
  it("parses a rejection and rejects extra keys", () => {
    const rejection = { reason: "Thiếu mô tả", refundAmount: 120, decidedAt: "2026-09-30T10:00:00.000Z" };
    expect(formRejectionSchema.parse(rejection)).toEqual(rejection);
    expect(formRejectionSchema.safeParse({ ...rejection, adminId: "x" }).success).toBe(false);
  });
});
