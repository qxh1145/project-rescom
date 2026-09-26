import { isoDateUpperBound, parseStrictIsoDate } from "./iso-date";

describe("parseStrictIsoDate", () => {
  it("accepts a real date-only value as UTC midnight", () => {
    expect(parseStrictIsoDate("2026-05-01")).toEqual({
      time: Date.UTC(2026, 4, 1),
      dateOnly: true,
    });
  });

  it("handles leap years", () => {
    expect(parseStrictIsoDate("2024-02-29")).not.toBeNull();
    expect(parseStrictIsoDate("2000-02-29")).not.toBeNull();
    expect(parseStrictIsoDate("2026-02-29")).toBeNull();
    expect(parseStrictIsoDate("1900-02-29")).toBeNull();
  });

  it("rejects impossible or malformed values instead of rolling them over", () => {
    for (const value of [
      "2026-02-31",
      "2026-04-31",
      "2026-99-99",
      "2026-00-10",
      "2026-01-00",
      "2026-05-01-2026",
      "2026-5-1",
      "2026-05-01T24:00",
      "2026-05-01T10:60",
      "2026-05-01T10:00:60",
      "2026-05-01T10:00+24:00",
      "2026-05-01T10:00+05:60",
      "2026-05-01T10",
      "2026-05-01 10:00",
      "2026-05-01T10:00:00.",
      "2026-05-01T10:00:00.1234567890Z",
      "2026-05-01T10:00+5",
      "2026-05-01T10:00+053",
      "2026-05-01T10:00+05:3",
      "2026-05-01T10:00+05:",
      "2026-05-01T10:00+2400",
      "2026-05-01T10:00+0560",
      "2026-05-01T10:00Zjunk",
      " 2026-05-01",
      "2026-05-01x",
      "",
      "not a date",
    ]) {
      expect(parseStrictIsoDate(value)).toBeNull();
    }
  });

  it("parses date-times with optional seconds, millis and zone", () => {
    expect(parseStrictIsoDate("2026-05-01T10:30")).toEqual({
      time: Date.UTC(2026, 4, 1, 10, 30),
      dateOnly: false,
    });
    expect(parseStrictIsoDate("2026-05-01T10:30:15.250Z")?.time).toBe(
      Date.UTC(2026, 4, 1, 10, 30, 15, 250),
    );
  });

  it("applies positive and negative offsets", () => {
    expect(parseStrictIsoDate("2026-05-01T10:00+07:00")?.time).toBe(
      Date.UTC(2026, 4, 1, 3, 0),
    );
    expect(parseStrictIsoDate("2026-05-01T22:30-02:30")?.time).toBe(
      Date.UTC(2026, 4, 2, 1, 0),
    );
    expect(parseStrictIsoDate("2026-05-01T00:00+00:00")?.time).toBe(
      parseStrictIsoDate("2026-05-01")?.time,
    );
  });

  it("accepts 1 to 9 fractional digits, truncated to milliseconds (review F13)", () => {
    expect(parseStrictIsoDate("2026-05-01T10:30:15.5Z")?.time).toBe(
      Date.UTC(2026, 4, 1, 10, 30, 15, 500),
    );
    expect(parseStrictIsoDate("2026-05-01T10:30:15.25Z")?.time).toBe(
      Date.UTC(2026, 4, 1, 10, 30, 15, 250),
    );
    expect(parseStrictIsoDate("2026-05-01T10:30:15.123456Z")?.time).toBe(
      Date.UTC(2026, 4, 1, 10, 30, 15, 123),
    );
    expect(parseStrictIsoDate("2026-05-01T10:30:15.999999999Z")?.time).toBe(
      Date.UTC(2026, 4, 1, 10, 30, 15, 999),
    );
  });

  it("accepts ±HHmm and ±HH offsets and lowercase t / z (review F13)", () => {
    const expected = Date.UTC(2026, 4, 1, 3, 0);
    expect(parseStrictIsoDate("2026-05-01T10:00+0700")?.time).toBe(expected);
    expect(parseStrictIsoDate("2026-05-01T10:00+07")?.time).toBe(expected);
    expect(parseStrictIsoDate("2026-05-01T22:30-0230")?.time).toBe(
      Date.UTC(2026, 4, 2, 1, 0),
    );
    expect(parseStrictIsoDate("2026-05-01t10:00:00.000z")).toEqual({
      time: Date.UTC(2026, 4, 1, 10, 0),
      dateOnly: false,
    });
    expect(parseStrictIsoDate("2026-05-01t03:00z")?.time).toBe(expected);
  });

  it("still rejects impossible calendar values in the new forms", () => {
    expect(parseStrictIsoDate("2026-02-29t10:00z")).toBeNull();
    expect(parseStrictIsoDate("2026-05-01T24:00+07")).toBeNull();
  });

  it("keeps years below 100 literal", () => {
    const parsed = parseStrictIsoDate("0050-01-01");
    expect(parsed && new Date(parsed.time).getUTCFullYear()).toBe(50);
  });
});

describe("isoDateUpperBound", () => {
  it("extends a date-only bound through the end of that UTC day", () => {
    const day = parseStrictIsoDate("2026-05-01")!;
    expect(isoDateUpperBound(day)).toBe(Date.UTC(2026, 4, 1, 23, 59, 59, 999));
  });

  it("keeps a date-time bound exact", () => {
    const instant = parseStrictIsoDate("2026-05-01T12:00Z")!;
    expect(isoDateUpperBound(instant)).toBe(instant.time);
  });
});
