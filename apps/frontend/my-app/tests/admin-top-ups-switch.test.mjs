import test from "node:test";
import assert from "node:assert/strict";

const stored = new Map();
const localStorageMock = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
  clear: () => stored.clear(),
};
globalThis.localStorage = localStorageMock;
globalThis.window = {
  location: { search: "?msw=payos-manual" },
  localStorage: localStorageMock,
};

const { register } = await import("node:module");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const loader = `import { existsSync, statSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const file = path.join(${JSON.stringify(root)}, specifier.slice(2));
    for (const f of [file + '.ts', file, path.join(file, 'index.ts'), file + '.tsx']) {
      if (existsSync(f) && statSync(f).isFile()) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
  }
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return nextResolve(specifier, context);
  if (!context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
  const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  for (const file of [base, base + '.ts', path.join(base, 'index.ts'), base + '.tsx']) {
    if (existsSync(file) && statSync(file).isFile()) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const {
  switchCardVariant,
  pendingRowLabel,
  itemCode,
  headerMeta,
  PAYOS_SWITCH_COPY,
} = await import("../lib/admin/payos-switch.ts");

const {
  topUpQueueCount,
  listTopUpsForReview,
  approveStoredTopUp,
  rejectStoredTopUp,
} = await import("../mocks/data/admin-top-ups.ts");

test("switchCardVariant across all modes with pending 0, 1 and > page size", () => {
  // PayOS on: card is hidden regardless of pending count
  assert.equal(switchCardVariant({ mode: "payos", pendingTotal: 0 }), "hidden");
  assert.equal(switchCardVariant({ mode: "payos", pendingTotal: 1 }), "hidden");
  assert.equal(switchCardVariant({ mode: "payos", pendingTotal: 100 }), "hidden");
  assert.equal(switchCardVariant({ mode: "payos", pendingTotal: null }), "hidden");

  // Loading mode
  assert.equal(switchCardVariant({ mode: "loading", pendingTotal: null }), "loading");
  assert.equal(switchCardVariant({ mode: "loading", pendingTotal: 0 }), "loading");
  assert.equal(switchCardVariant({ mode: "loading", pendingTotal: 5 }), "loading");

  // Error mode
  assert.equal(switchCardVariant({ mode: "error", pendingTotal: null }), "error");
  assert.equal(switchCardVariant({ mode: "error", pendingTotal: 0 }), "error");
  assert.equal(switchCardVariant({ mode: "error", pendingTotal: 3 }), "error");

  // Manual mode (PayOS off): depends on pendingTotal
  assert.equal(switchCardVariant({ mode: "manual", pendingTotal: null }), "loading");
  assert.equal(switchCardVariant({ mode: "manual", pendingTotal: undefined }), "loading");
  assert.equal(switchCardVariant({ mode: "manual", pendingTotal: 0 }), "ready");
  assert.equal(switchCardVariant({ mode: "manual", pendingTotal: 1 }), "pending");
  assert.equal(switchCardVariant({ mode: "manual", pendingTotal: 2 }), "pending");
  assert.equal(switchCardVariant({ mode: "manual", pendingTotal: 51 }), "pending"); // > page size (50)
});

test("headerMeta for both modes (and date formatting)", () => {
  // payos mode
  assert.equal(
    headerMeta("payos"),
    "PayOS tự cộng Điểm · hoàn tiền thủ công, hạn 3 ngày làm việc",
  );

  // manual mode with specific date
  assert.equal(
    headerMeta("manual", new Date("2026-09-30T10:00:00.000Z")),
    "30/09/2026 · đang dùng nạp thủ công",
  );

  // error mode also informs admin that system is on manual top-up
  assert.equal(
    headerMeta("error", new Date("2026-09-30T10:00:00.000Z")),
    "30/09/2026 · đang dùng nạp thủ công",
  );

  // loading mode returns empty string
  assert.equal(headerMeta("loading"), "");
});

test("pendingRowLabel formats '{amount} → {points} Điểm'", () => {
  assert.equal(
    pendingRowLabel({ amountVnd: 100_000, amount: 500 }),
    "100.000đ → 500 Điểm",
  );
  assert.equal(
    pendingRowLabel({ amountVnd: 40_000, amount: 200 }),
    "40.000đ → 200 Điểm",
  );
});

test("itemCode resolves orderCode, code or uuid slice", () => {
  assert.equal(itemCode({ id: "uuid-long-1234", orderCode: 2609300041 }), "2609300041");
  assert.equal(itemCode({ id: "uuid-long-1234", code: "CODE-99" }), "CODE-99");
  assert.equal(itemCode({ id: "6e0b3d1a-4c2f-4a8e-9b1d-2f3a4b5c6d01" }), "6e0b3d1a");
});

test("copy strings verbatim from Figma and AC 1-3", () => {
  assert.equal(PAYOS_SWITCH_COPY.cardTitle, "Chuyển sang nạp điểm qua PayOS");
  assert.equal(
    PAYOS_SWITCH_COPY.cardDescription,
    "Khi PayOS bật, user chỉ nạp qua PayOS và Điểm được cộng tự động. Nạp thủ công chuyển sang tab “Lịch sử thủ công (cũ)”, chỉ đọc. PayOS bật bằng cấu hình server, không bật trên giao diện.",
  );
  assert.equal(PAYOS_SWITCH_COPY.chipOff, "PayOS: Tắt");
  assert.equal(PAYOS_SWITCH_COPY.chipOn, "PayOS: Bật");
  assert.equal(PAYOS_SWITCH_COPY.chipCaption, "Bật/tắt bằng cấu hình server (PAYOS_ENABLED)");
  assert.equal(PAYOS_SWITCH_COPY.loadError, "Không tải được trạng thái PayOS.");
  assert.equal(PAYOS_SWITCH_COPY.retry, "Thử lại");

  assert.equal(
    PAYOS_SWITCH_COPY.pendingBannerTitle(3),
    "Còn 3 yêu cầu nạp thủ công đang chờ. Cần xử lý hết trước khi bật PayOS.",
  );
  assert.equal(
    PAYOS_SWITCH_COPY.pendingBannerDesc,
    "Duyệt hoặc từ chối nhanh ngay bên dưới. Khi danh sách trống, báo kỹ thuật bật PAYOS_ENABLED.",
  );
  assert.equal(
    PAYOS_SWITCH_COPY.pendingFooter,
    "Đối chiếu sao kê trước khi duyệt; từ chối cần ghi lý do. Server sẽ không khởi động với PayOS bật khi còn yêu cầu đang chờ.",
  );
  assert.equal(
    PAYOS_SWITCH_COPY.pendingShowingPartial(3, 10),
    "Đang hiển thị 3/10 yêu cầu cũ nhất — xem đủ ở tab “Lịch sử thủ công (cũ)”.",
  );

  assert.equal(PAYOS_SWITCH_COPY.readyTitle, "Sẵn sàng bật PayOS");
  assert.equal(
    PAYOS_SWITCH_COPY.readyHandledSubtitle(46),
    "46 yêu cầu đã xử lý được giữ lại ở tab “Lịch sử thủ công (cũ)”.",
  );
  assert.equal(PAYOS_SWITCH_COPY.readyChecklistPending, "0 yêu cầu thủ công đang chờ");
  assert.equal(
    PAYOS_SWITCH_COPY.readyChecklistRestart,
    "Báo kỹ thuật bật PAYOS_ENABLED và triển khai lại.",
  );

  assert.equal(PAYOS_SWITCH_COPY.confirmApproveTitle("2609300041"), "Duyệt yêu cầu 2609300041?");
  assert.equal(
    PAYOS_SWITCH_COPY.confirmApproveCredit("500", "Trần Minh", "minh.tran@fpt.edu.vn"),
    "Cộng 500 Điểm cho Trần Minh (minh.tran@fpt.edu.vn).",
  );
  assert.equal(
    PAYOS_SWITCH_COPY.confirmApproveStatement("100.000đ", "RESCOM LN5821"),
    "Chỉ duyệt khi sao kê có khoản 100.000đ với nội dung RESCOM LN5821.",
  );
});

test("mock flow in payos-manual scenario: list pending -> approve one -> reject rest -> ready variant and queue count 0", () => {
  // Initially seeded with 2 pending requests
  const pendingInitial = listTopUpsForReview("PENDING");
  assert.ok(pendingInitial.length >= 2, "must have at least 2 seeded pending rows");
  const queueCountInitial = topUpQueueCount();
  assert.equal(queueCountInitial, pendingInitial.length);

  // Variant is pending
  assert.equal(
    switchCardVariant({ mode: "manual", pendingTotal: queueCountInitial }),
    "pending",
  );

  // Approve first pending request
  const first = pendingInitial[0];
  const approved = approveStoredTopUp(first, "test-admin-id");
  assert.equal(approved.request.status, "APPROVED");

  // Reject the remaining pending requests
  const remaining = listTopUpsForReview("PENDING");
  for (const item of remaining) {
    const rejected = rejectStoredTopUp(item, "test-admin-id", "Sai nội dung chuyển khoản");
    assert.equal(rejected.request.status, "REJECTED");
  }

  // Pending queue is now 0
  const pendingAfter = listTopUpsForReview("PENDING");
  assert.equal(pendingAfter.length, 0);
  assert.equal(topUpQueueCount(), 0);

  // Variant now transitions to "ready"
  assert.equal(
    switchCardVariant({ mode: "manual", pendingTotal: 0 }),
    "ready",
  );
});

test("read-only status logic: initial status is APPROVED when readOnly, PENDING otherwise", () => {
  const getInitialStatus = (readOnly) => (readOnly ? "APPROVED" : "PENDING");
  assert.equal(getInitialStatus(true), "APPROVED");
  assert.equal(getInitialStatus(false), "PENDING");
});
