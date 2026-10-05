import test from "node:test";
import assert from "node:assert/strict";

const {
  canGoBackWithinSite,
  countdownAnnouncement,
  formatCountdown,
  formatIncidentCode,
  formatMaintenanceEnd,
  parseRateLimitReason,
  parseRetryAfterSeconds,
  randomIncidentCode,
  resolveReturnPath,
} = await import("../lib/feedback/error-pages.ts");

test("formatIncidentCode groups the digest in fours", () => {
  assert.equal(formatIncidentCode("a7f32109"), "A7F3-2109");
  assert.equal(formatIncidentCode("2912648213"), "2912-6482-13");
  assert.equal(formatIncidentCode("12@34"), "1234");
  assert.equal(formatIncidentCode(""), null);
  assert.equal(formatIncidentCode(undefined), null);
});

test("randomIncidentCode is 8 hex chars", () => {
  assert.match(randomIncidentCode(), /^[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(randomIncidentCode(() => 0), "0000-0000");
});

test("parseRetryAfterSeconds falls back to 60", () => {
  assert.equal(parseRetryAfterSeconds("1104"), 1104);
  assert.equal(parseRetryAfterSeconds(undefined), 60);
  assert.equal(parseRetryAfterSeconds("0"), 60);
  assert.equal(parseRetryAfterSeconds("-5"), 60);
  assert.equal(parseRetryAfterSeconds("12.5"), 60);
  assert.equal(parseRetryAfterSeconds("abc"), 60);
  assert.equal(parseRetryAfterSeconds("999999"), 60);
});

test("formatCountdown", () => {
  assert.equal(formatCountdown(1104), "18:24");
  assert.equal(formatCountdown(59), "00:59");
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(-3), "00:00");
  assert.equal(formatCountdown(3900), "1:05:00");
});

test("countdownAnnouncement changes once per minute", () => {
  assert.equal(countdownAnnouncement(1104), countdownAnnouncement(1081));
  assert.notEqual(countdownAnnouncement(1081), countdownAnnouncement(1080));
  assert.equal(countdownAnnouncement(0), "Bạn có thể nhận khảo sát mới ngay bây giờ.");
  // A throttled session check says nothing about surveys.
  assert.equal(countdownAnnouncement(0, "session"), "Bạn có thể thử lại ngay bây giờ.");
  assert.equal(countdownAnnouncement(1104, "session"), countdownAnnouncement(1104));
});

test("parseRateLimitReason: only `session` switches /rate-limited to the neutral copy", () => {
  assert.equal(parseRateLimitReason("session"), "session");
  for (const raw of [undefined, null, "", "participation", "SESSION", "other"]) {
    assert.equal(parseRateLimitReason(raw), "participation", String(raw));
  }
});

test("formatMaintenanceEnd formats HH:mm in Vietnam time", () => {
  assert.equal(formatMaintenanceEnd("2026-09-27T07:30:00Z"), "14:30");
  assert.equal(formatMaintenanceEnd("not a date"), null);
  assert.equal(formatMaintenanceEnd(""), null);
  assert.equal(formatMaintenanceEnd(undefined), null);
});

test("resolveReturnPath keeps same-origin app paths only", () => {
  assert.equal(resolveReturnPath("/wallet?tab=history"), "/wallet?tab=history");
  assert.equal(resolveReturnPath("//evil.example"), null);
  assert.equal(resolveReturnPath("https://evil.example"), null);
  assert.equal(resolveReturnPath("/\t/evil.example"), null);
  assert.equal(resolveReturnPath("/offline?from=/wallet"), null);
  assert.equal(resolveReturnPath("/rate-limited"), null);
  assert.equal(resolveReturnPath(null), null);
});

test("resolveReturnPath rejects dot segments that collapse into //host", () => {
  for (const raw of ["/.//evil.com", "/a/..//evil.com", "/%2e%2e//evil.com", "/%2E%2e//evil.com?x=1"]) {
    assert.equal(resolveReturnPath(raw), null, raw);
  }
  assert.equal(resolveReturnPath("/a/../wallet"), "/wallet");
});

test("canGoBackWithinSite never sends the user to another site", () => {
  const origin = "https://rescom.vn";
  // Navigation API knows the same-origin history exactly.
  assert.equal(canGoBackWithinSite({ navigationCanGoBack: true, referrer: "", origin, historyLength: 1 }), true);
  assert.equal(
    canGoBackWithinSite({ navigationCanGoBack: false, referrer: `${origin}/wallet`, origin, historyLength: 5 }),
    false,
  );
  // Fallback: same-origin referrer + an entry to go back to.
  assert.equal(canGoBackWithinSite({ referrer: `${origin}/wallet`, origin, historyLength: 3 }), true);
  assert.equal(canGoBackWithinSite({ referrer: "https://www.google.com/", origin, historyLength: 3 }), false);
  assert.equal(canGoBackWithinSite({ referrer: "https://rescom.vn.evil.com/", origin, historyLength: 3 }), false);
  assert.equal(canGoBackWithinSite({ referrer: "", origin, historyLength: 3 }), false);
  assert.equal(canGoBackWithinSite({ referrer: `${origin}/wallet`, origin, historyLength: 1 }), false);
  assert.equal(canGoBackWithinSite({ referrer: "not a url", origin, historyLength: 3 }), false);
});
