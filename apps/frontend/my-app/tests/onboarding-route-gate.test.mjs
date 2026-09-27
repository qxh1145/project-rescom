import test from "node:test";
import assert from "node:assert/strict";

const { onboardingEntryRedirect, onboardingGateRedirect, onboardingStatusOf } = await import(
  "../lib/session/onboarding-gate.ts"
);

test("onboardingStatusOf reads GET /demographics and fails open", () => {
  assert.equal(onboardingStatusOf("RESPONDENT", { isComplete: true }), "complete");
  assert.equal(onboardingStatusOf("RESPONDENT", { isComplete: false }), "incomplete");
  assert.equal(onboardingStatusOf("RESPONDENT", null), "unknown");
  assert.equal(onboardingStatusOf("PUBLISHER", { isComplete: false }), "incomplete");
  assert.equal(onboardingStatusOf("ADMIN", { isComplete: false }), "unknown");
});

test("onboardingGateRedirect sends an unfinished respondent to onboarding with returnTo", () => {
  const gate = (overrides) =>
    onboardingGateRedirect({
      role: "RESPONDENT",
      onboarding: "incomplete",
      pathname: "/wallet",
      currentPath: "/wallet?tab=history",
      ...overrides,
    });

  assert.equal(gate({}), "/onboarding?required=1&returnTo=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(
    gate({ pathname: "/marketplace", currentPath: "/marketplace" }),
    "/onboarding?required=1&returnTo=%2Fmarketplace",
  );
  // Already there (any step) — no loop.
  assert.equal(gate({ pathname: "/onboarding", currentPath: "/onboarding?step=gender" }), null);
  assert.equal(gate({ onboarding: "complete" }), null);
  assert.equal(gate({ onboarding: "unknown" }), null);
  assert.equal(gate({ role: "ADMIN" }), null);
  // Publishers fill in the same profile (same rule as the post-login redirect).
  assert.equal(gate({ role: "PUBLISHER" }), "/onboarding?required=1&returnTo=%2Fwallet%3Ftab%3Dhistory");
});

test("onboardingEntryRedirect keeps finished respondents out of /onboarding", () => {
  const entry = (overrides) =>
    onboardingEntryRedirect({
      role: "RESPONDENT",
      onboarding: "complete",
      requestedStep: "welcome",
      submittedInThisTab: false,
      editing: false,
      ...overrides,
    });

  assert.equal(entry({}), "/marketplace");
  assert.equal(entry({ requestedStep: "gender" }), "/marketplace");
  // A done screen from another tab/session, or a typed `?step=done`, is not enough.
  assert.equal(entry({ requestedStep: "done" }), "/marketplace");
  assert.equal(entry({ requestedStep: "welcome", submittedInThisTab: true }), "/marketplace");
  // Refreshing the done screen right after this tab's submit keeps the activation step.
  assert.equal(entry({ requestedStep: "done", submittedInThisTab: true }), null);
  // "Sửa" on /account/profile (`edit=1`) opens a question; the bare welcome screen stays closed.
  assert.equal(entry({ editing: true, requestedStep: "birth-year" }), null);
  assert.equal(entry({ editing: true, requestedStep: "welcome" }), "/marketplace");
  // Not finished (or unknown): the flow opens.
  assert.equal(entry({ onboarding: "incomplete" }), null);
  assert.equal(entry({ onboarding: "unknown" }), null);
  // Admins have no respondent profile.
  assert.equal(entry({ role: "ADMIN", onboarding: "unknown" }), "/admin");
});
