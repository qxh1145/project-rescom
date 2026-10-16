import test from "node:test";
import assert from "node:assert/strict";

const {
  topUpChip,
  MANUAL_REFUNDED_COPY,
  mergeTopUps,
} = await import("../lib/wallet/top-up-history.ts");

test("top-up history chips and status mapping", async (t) => {
  await t.test("PayOS chips have correct labels, icons and tones", () => {
    assert.deepEqual(topUpChip("PROCESSING", "PAYOS"), {
      label: "Đang chờ thanh toán",
      icon: "hourglass",
      tone: "amber",
    });
    assert.deepEqual(topUpChip("SUCCESSFUL", "PAYOS"), {
      label: "Thành công",
      icon: "check",
      tone: "green",
    });
    assert.deepEqual(topUpChip("CANCELLED", "PAYOS"), {
      label: "Đã huỷ",
      icon: "x",
      tone: "grey",
    });
    assert.deepEqual(topUpChip("EXPIRED", "PAYOS"), {
      label: "Hết hạn",
      icon: "hourglass",
      tone: "grey",
    });
    assert.deepEqual(topUpChip("AMOUNT_MISMATCH", "PAYOS"), {
      label: "Chờ đối chiếu",
      icon: "alert-triangle",
      tone: "amber",
    });
    assert.deepEqual(topUpChip("MANUAL_REFUNDED", "PAYOS"), {
      label: "Đã hoàn tiền",
      icon: "refund",
      tone: "teal",
    });
  });

  await t.test("manual chips have correct labels, icons and tones", () => {
    assert.deepEqual(topUpChip("PENDING", "MANUAL"), {
      label: "Chờ duyệt",
      icon: "hourglass",
      tone: "amber",
    });
    assert.deepEqual(topUpChip("APPROVED", "MANUAL"), {
      label: "Thành công",
      icon: "check",
      tone: "green",
    });
    assert.deepEqual(topUpChip("REJECTED", "MANUAL"), {
      label: "Từ chối",
      icon: "x",
      tone: "danger",
    });
  });

  await t.test("MANUAL_REFUNDED copy matches AC4", () => {
    assert.equal(
      MANUAL_REFUNDED_COPY,
      "Đã hoàn tiền thủ công cho thanh toán sai số tiền — không có Điểm nào được cộng",
    );
  });
});

test("mapping and merging of top-ups", async () => {
  const manual = {
    id: "m-1",
    amount: 100, // 100 points
    amountVnd: 20000,
    status: "APPROVED",
    transferReference: "RESCOM123456",
    rejectionReason: null,
    createdAt: "2026-10-15T10:00:00.000Z",
    reviewedAt: "2026-10-15T10:05:00.000Z",
    paymentInstructions: null,
  };

  const payos1 = {
    id: "p-1",
    orderCode: 1001,
    amountVnd: 50000,
    points: 250,
    status: "PROCESSING",
    checkoutUrl: "https://pay.payos.vn/web/1001",
    expiresAt: "2026-10-15T10:35:00.000Z",
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-10-15T10:30:00.000Z",
  };

  const payos2 = {
    id: "p-2",
    orderCode: 1002,
    amountVnd: 20000,
    points: 100,
    status: "SUCCESSFUL",
    checkoutUrl: null,
    expiresAt: "2026-10-15T09:35:00.000Z",
    cancelledAt: null,
    paidAt: "2026-10-15T09:32:00.000Z",
    createdAt: "2026-10-15T09:30:00.000Z",
  };

  const merged = mergeTopUps([manual], [payos1, payos2], 20);
  assert.equal(merged.length, 3);
  // Newest first: payos1 (10:30) -> manual (10:00) -> payos2 (09:30)
  assert.equal(merged[0].id, "p-1");
  assert.equal(merged[0].channel, "PAYOS");
  assert.equal(merged[0].code, "1001");
  assert.equal(merged[0].amountVnd, 50000);
  assert.equal(merged[0].points, 250);

  assert.equal(merged[1].id, "m-1");
  assert.equal(merged[1].channel, "MANUAL");
  assert.equal(merged[1].code, "RESCOM123456");
  assert.equal(merged[1].amountVnd, 20000);
  assert.equal(merged[1].points, 100);

  assert.equal(merged[2].id, "p-2");
  assert.equal(merged[2].channel, "PAYOS");
});
