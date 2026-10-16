import test from "node:test";
import assert from "node:assert/strict";

const {
  REFUND_REASON_OPTIONS,
  refundReasonLabel,
  refundCountdownLabel,
  refundSectionView,
  validateRefundForm,
  refundDestinationLabel,
  refundDueDate,
  refundDueLabel,
  refundUnavailableCopy,
  ineligibleCopy,
  refundTimelineSteps,
} = await import("../lib/wallet/top-up-refund.ts");

test("top-up refund rules and presentation helpers (Story 13.11, Task 3 & 7)", async (t) => {
  await t.test("refundSectionView returns hidden for non-successful status without request", () => {
    assert.deepEqual(
      refundSectionView({
        status: "PROCESSING",
        refund: { canRequest: false, unavailableReason: "NOT_SUCCESSFUL", request: null },
        refundDeadline: null,
      }),
      { kind: "hidden" },
    );
    assert.deepEqual(
      refundSectionView({
        status: "CANCELLED",
        refund: { canRequest: false, unavailableReason: "NOT_SUCCESSFUL", request: null },
        refundDeadline: null,
      }),
      { kind: "hidden" },
    );
    assert.deepEqual(
      refundSectionView({
        status: "EXPIRED",
        refund: { canRequest: false, unavailableReason: "NOT_SUCCESSFUL", request: null },
        refundDeadline: null,
      }),
      { kind: "hidden" },
    );
  });

  await t.test("refundSectionView returns each unavailableReason correctly", () => {
    const reasons = [
      "DEADLINE_PASSED",
      "LEGACY_MANUAL",
      "MISMATCH_CREDITED",
      "WITHDRAWN",
      "ALREADY_REQUESTED",
    ];
    for (const reason of reasons) {
      assert.deepEqual(
        refundSectionView({
          status: "SUCCESSFUL",
          refund: { canRequest: false, unavailableReason: reason, request: null },
          refundDeadline: null,
        }),
        { kind: "unavailable", reason },
      );
    }
  });

  await t.test("refundSectionView handles available and client deadline expiry", () => {
    const now = new Date("2026-10-16T10:00:00.000Z");
    const futureDeadline = new Date("2026-10-16T15:00:00.000Z");

    // Before deadline -> available
    const availableView = refundSectionView(
      {
        status: "SUCCESSFUL",
        refund: { canRequest: true, unavailableReason: null, request: null },
        refundDeadline: futureDeadline.toISOString(),
      },
      now,
    );
    assert.equal(availableView.kind, "available");
    assert.equal(availableView.countdown, "Còn 5 giờ");

    // At exact deadline -> DEADLINE_PASSED
    const exactView = refundSectionView(
      {
        status: "SUCCESSFUL",
        refund: { canRequest: true, unavailableReason: null, request: null },
        refundDeadline: now.toISOString(),
      },
      now,
    );
    assert.deepEqual(exactView, { kind: "unavailable", reason: "DEADLINE_PASSED" });

    // 1 ms past deadline -> DEADLINE_PASSED
    const pastDeadline = new Date(now.getTime() - 1);
    const pastView = refundSectionView(
      {
        status: "SUCCESSFUL",
        refund: { canRequest: true, unavailableReason: null, request: null },
        refundDeadline: pastDeadline.toISOString(),
      },
      now,
    );
    assert.deepEqual(pastView, { kind: "unavailable", reason: "DEADLINE_PASSED" });
  });

  await t.test("refundSectionView returns request when request exists", () => {
    const req = {
      id: "55555555-5555-5555-8555-555555555555",
      status: "REQUESTED",
      eligibility: "ELIGIBLE",
      ineligibleReason: null,
      reason: "WRONG_AMOUNT",
      points: 50,
      amountVnd: 50000,
      destination: {
        bankId: "970436",
        bankName: "Vietcombank",
        holderName: "TRAN THI A",
        accountNumber: "0123456789",
        last4: "6789",
        verified: true,
      },
      submittedAt: "2026-10-16T10:00:00.000Z",
      withdrawnAt: null,
    };

    assert.deepEqual(
      refundSectionView({
        status: "SUCCESSFUL",
        refund: { canRequest: false, unavailableReason: "ALREADY_REQUESTED", request: req },
        refundDeadline: null,
      }),
      { kind: "request", request: req },
    );
  });

  await t.test("refundCountdownLabel formats intervals correctly", () => {
    const now = new Date("2026-10-16T10:00:00.000Z");

    // 25 hours
    const d25h = new Date(now.getTime() + 25 * 3600 * 1000);
    assert.equal(refundCountdownLabel(d25h, now), "Còn 25 giờ");

    // 23 hours 59 mins -> "Còn 23 giờ" (floor)
    const d23h59m = new Date(now.getTime() + (23 * 3600 + 59 * 60) * 1000);
    assert.equal(refundCountdownLabel(d23h59m, now), "Còn 23 giờ");

    // 59 mins -> "Còn 59 phút"
    const d59m = new Date(now.getTime() + 59 * 60 * 1000);
    assert.equal(refundCountdownLabel(d59m, now), "Còn 59 phút");

    // 30 seconds -> "Còn 1 phút" (ceil, min 1)
    const d30s = new Date(now.getTime() + 30 * 1000);
    assert.equal(refundCountdownLabel(d30s, now), "Còn 1 phút");

    // exact / passed -> null
    assert.equal(refundCountdownLabel(now, now), null);
    assert.equal(refundCountdownLabel(new Date(now.getTime() - 1000), now), null);
  });

  await t.test("validateRefundForm enforces validation rules", () => {
    // Missing reason
    const noReason = validateRefundForm({ reason: null, note: "Ghi chú hợp lệ" });
    assert.equal(noReason.ok, false);
    assert.equal(noReason.errors?.reason, "Chọn một lý do hoàn tiền.");

    // Empty / whitespace note
    const emptyNote = validateRefundForm({ reason: "WRONG_AMOUNT", note: "" });
    assert.equal(emptyNote.ok, false);
    assert.equal(emptyNote.errors?.note, "Nhập ghi chú cho Admin (tối đa 300 ký tự).");

    const wsNote = validateRefundForm({ reason: "WRONG_AMOUNT", note: "   " });
    assert.equal(wsNote.ok, false);
    assert.equal(wsNote.errors?.note, "Nhập ghi chú cho Admin (tối đa 300 ký tự).");

    // 1 char valid
    const valid1 = validateRefundForm({ reason: "WRONG_AMOUNT", note: "A" });
    assert.equal(valid1.ok, true);
    assert.equal(valid1.value?.note, "A");

    // 300 chars valid
    const note300 = "a".repeat(300);
    const valid300 = validateRefundForm({ reason: "OTHER", note: note300 });
    assert.equal(valid300.ok, true);
    assert.equal(valid300.value?.note, note300);

    // 301 chars -> "hãy rút gọn 1 ký tự"
    const note301 = "a".repeat(301);
    const invalid301 = validateRefundForm({ reason: "OTHER", note: note301 });
    assert.equal(invalid301.ok, false);
    assert.equal(invalid301.errors?.note, "Tối đa 300 ký tự — hãy rút gọn 1 ký tự.");

    // Trims whitespace before counting length
    const padded = "   " + "b".repeat(300) + "   ";
    const validPadded = validateRefundForm({ reason: "NO_LONGER_NEEDED", note: padded });
    assert.equal(validPadded.ok, true);
    assert.equal(validPadded.value?.note, "b".repeat(300));
  });

  await t.test("refundDestinationLabel formats verified and unverified destinations with full account number", () => {
    // Verified
    const verified = refundDestinationLabel({
      bankId: "970436",
      bankName: "Vietcombank",
      holderName: "TRAN THI A",
      accountNumber: "0123456789",
      last4: "6789",
      verified: true,
    });
    assert.equal(verified.verified, true);
    assert.equal(verified.bank, "Vietcombank");
    assert.equal(verified.accountNumber, "0123456789");
    assert.equal(verified.holder, "TRAN THI A");

    // bankName null -> uses bankId
    const fallbackBank = refundDestinationLabel({
      bankId: "970422",
      bankName: null,
      holderName: null,
      accountNumber: "0987654321",
      last4: "4321",
      verified: false,
    });
    assert.equal(fallbackBank.verified, false);
    assert.equal(fallbackBank.bank, "Mã ngân hàng 970422");
    assert.equal(fallbackBank.accountNumber, "0987654321");
    assert.equal(fallbackBank.holder, null);

    // null destination
    const nullDest = refundDestinationLabel(null);
    assert.equal(nullDest.verified, false);
    assert.equal(nullDest.bank, "Ngân hàng");
    assert.equal(nullDest.accountNumber, null);
    assert.equal(nullDest.holder, null);
  });

  await t.test("refundDueDate and refundDueLabel calculate business days across weekends", () => {
    // Friday 2026-10-16 -> 3 business days = Wednesday 2026-10-21
    const friday = new Date("2026-10-16T10:00:00.000Z");
    const due = refundDueDate(friday);
    assert.equal(due.getUTCDay(), 3); // Wednesday

    // Friday now -> "còn 3 ngày làm việc"
    const labelFri = refundDueLabel(friday, friday);
    assert.match(labelFri, /còn 3 ngày làm việc/);

    // Past due -> "Quá hạn"
    const pastNow = new Date("2026-10-22T10:00:00.000Z");
    const labelPast = refundDueLabel(friday, pastNow);
    assert.equal(labelPast, "Quá hạn");
  });

  await t.test("refundUnavailableCopy and ineligibleCopy are exhaustive", () => {
    const unavailEnums = [
      "DEADLINE_PASSED",
      "LEGACY_MANUAL",
      "MISMATCH_CREDITED",
      "WITHDRAWN",
      "ALREADY_REQUESTED",
      "NOT_SUCCESSFUL",
    ];
    for (const code of unavailEnums) {
      const copy = refundUnavailableCopy(code, { paidAt: "2026-10-15T10:00:00.000Z" });
      if (code === "NOT_SUCCESSFUL") {
        assert.equal(copy, "");
      } else {
        assert.ok(copy.length > 0, `Missing copy for ${code}`);
      }
    }

    const ineligEnums = ["SPENT_SINCE_TOP_UP", "INSUFFICIENT_AVAILABLE"];
    for (const code of ineligEnums) {
      const copy = ineligibleCopy(code);
      assert.ok(copy.length > 0, `Missing copy for ${code}`);
    }
  });

  await t.test("refundTimelineSteps returns appropriate timeline steps per status", () => {
    const base = {
      id: "55555555-5555-5555-8555-555555555555",
      eligibility: "ELIGIBLE",
      ineligibleReason: null,
      reason: "WRONG_AMOUNT",
      points: 50,
      amountVnd: 50000,
      destination: {
        bankId: "970436",
        bankName: "Vietcombank",
        holderName: "TRAN THI A",
        accountNumber: "0123456789",
        last4: "6789",
        verified: true,
      },
      submittedAt: "2026-10-16T10:00:00.000Z",
      withdrawnAt: null,
    };

    // REQUESTED ELIGIBLE
    const reqSteps = refundTimelineSteps({ ...base, status: "REQUESTED" });
    assert.equal(reqSteps.length, 2);
    assert.equal(reqSteps[0].title, "Gửi yêu cầu hoàn tiền");
    assert.equal(reqSteps[0].detail, "Đủ điều kiện hoàn tiền");
    assert.equal(reqSteps[1].title, "Chờ Admin chuyển khoản");
    assert.equal(reqSteps[1].state, "current");

    // REQUESTED NOT_ELIGIBLE
    const ineligSteps = refundTimelineSteps({
      ...base,
      status: "REQUESTED",
      eligibility: "NOT_ELIGIBLE",
    });
    assert.equal(ineligSteps[0].detail, "Không đủ điều kiện hoàn tiền");
    assert.equal(ineligSteps[1].title, "Chờ Admin phản hồi");

    // REFUNDED
    const refSteps = refundTimelineSteps({
      ...base,
      status: "REFUNDED",
      bankTransferReference: "REF123456",
    });
    assert.equal(refSteps[1].title, "Admin đã chuyển khoản hoàn tiền");
    assert.match(refSteps[1].detail, /REF123456/);
    assert.equal(refSteps[1].state, "done");

    // REJECTED
    const rejSteps = refundTimelineSteps({
      ...base,
      status: "REJECTED",
      rejectionReason: "Sai thông tin",
    });
    assert.equal(rejSteps[1].title, "Admin từ chối hoàn tiền");
    assert.equal(rejSteps[1].detail, "Sai thông tin");
    assert.equal(rejSteps[1].state, "failed");

    // WITHDRAWN
    const withSteps = refundTimelineSteps({
      ...base,
      status: "WITHDRAWN",
      withdrawnAt: "2026-10-16T11:00:00.000Z",
    });
    assert.equal(withSteps[1].title, "Đã rút yêu cầu");
    assert.equal(withSteps[1].state, "failed");
  });

  await t.test("refundReasonLabel returns mapped option or fallback", () => {
    assert.equal(REFUND_REASON_OPTIONS.length, 4);
    assert.equal(refundReasonLabel("WRONG_AMOUNT"), "Nạp nhầm số tiền");
    assert.equal(refundReasonLabel("WRONG_ACCOUNT"), "Nạp nhầm tài khoản Rescom");
    assert.equal(refundReasonLabel("NO_LONGER_NEEDED"), "Không còn nhu cầu dùng Điểm");
    assert.equal(refundReasonLabel("OTHER"), "Lý do khác");
    assert.equal(refundReasonLabel("CUSTOM"), "CUSTOM");
  });
});
