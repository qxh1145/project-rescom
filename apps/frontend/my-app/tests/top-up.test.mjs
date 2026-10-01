import test from "node:test";
import assert from "node:assert/strict";

function createMockStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("Story 6.6: mock point top-up requests", async (t) => {
  const {
    topUpRequestSchema,
    topUpRequestListSchema,
    buildVietQrPayload,
    TOP_UP_MAX_PENDING_REQUESTS,
  } = await import("@rescom/schemas");
  const { mockRepository } = await import("../mocks/legacy/repository.ts");
  const { setMockStorage, loadStore, saveStore } = await import(
    "../mocks/legacy/store.ts"
  );

  t.beforeEach(async () => {
    setMockStorage(createMockStorage());
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
    await mockRepository.switchDemoUser("user-active-002");
  });

  await t.test("exposes the conversion rate, limits and demo bank account", async () => {
    const options = await mockRepository.getTopUpOptions();
    assert.equal(options.pointVndRate, 200);
    assert.equal(options.minPoints, 100);
    assert.equal(options.maxPendingRequests, TOP_UP_MAX_PENDING_REQUESTS);
    assert.deepEqual(options.presetAmounts, [100, 250, 500, 1000]);
    assert.equal(options.bank.bankBin, "970436");
  });

  await t.test("creates a Pending Payment request with transfer syntax and VietQR payload", async () => {
    const before = await mockRepository.getWalletDetails();
    const request = await mockRepository.createTopUpRequest(150);

    // Same contract as the live API, so the later swap needs no mapping.
    assert.equal(topUpRequestSchema.safeParse(request).success, true);
    assert.equal(request.status, "PENDING");
    assert.equal(request.amountVnd, 30_000);
    assert.match(request.transferReference, /^RESCOM[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(request.paymentInstructions.transferContent, request.transferReference);
    assert.equal(
      request.paymentInstructions.qrPayload,
      buildVietQrPayload({
        bankBin: "970436",
        accountNumber: "0000000000",
        amountVnd: 30_000,
        transferContent: request.transferReference,
      }),
    );
    assert.equal("userId" in request, false);

    // Points are credited only after an Admin approves the transfer.
    const after = await mockRepository.getWalletDetails();
    assert.deepEqual(after.balance, before.balance);
    assert.equal(after.transactions.length, before.transactions.length);
  });

  await t.test("lists the current user's requests newest first", async () => {
    const first = await mockRepository.createTopUpRequest(100);
    const second = await mockRepository.createTopUpRequest(250);

    const list = await mockRepository.getMyTopUpRequests();
    assert.equal(topUpRequestListSchema.safeParse(list).success, true);
    assert.deepEqual(
      list.items.map((item) => item.id),
      [second.id, first.id],
    );
    assert.notEqual(first.transferReference, second.transferReference);

    await mockRepository.switchDemoUser("user-new-001");
    const otherList = await mockRepository.getMyTopUpRequests();
    assert.equal(otherList.total, 0);
    assert.deepEqual(otherList.items, []);
  });

  await t.test("rejects amounts outside the allowed range with Vietnamese messages", async () => {
    await assert.rejects(mockRepository.createTopUpRequest(99), (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, /tối thiểu 100 điểm/);
      return true;
    });
    await assert.rejects(mockRepository.createTopUpRequest(50_001), (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, /tối đa/);
      return true;
    });
    await assert.rejects(mockRepository.createTopUpRequest(120.5), (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    });
    assert.equal((await mockRepository.getMyTopUpRequests()).total, 0);
  });

  await t.test("limits open (pending) requests per user", async () => {
    for (let i = 0; i < TOP_UP_MAX_PENDING_REQUESTS; i += 1) {
      await mockRepository.createTopUpRequest(100);
    }
    await assert.rejects(mockRepository.createTopUpRequest(100), (error) => {
      assert.equal(error.code, "TOPUP_PENDING_LIMIT_REACHED");
      return true;
    });

    // Reviewed requests no longer count towards the limit.
    const state = loadStore();
    state.topUpRequests["user-active-002"][0].status = "APPROVED";
    state.topUpRequests["user-active-002"][0].paymentInstructions = null;
    saveStore(state);
    const extra = await mockRepository.createTopUpRequest(100);
    assert.equal(extra.status, "PENDING");
  });

  await t.test("requires a signed-in user", async () => {
    await mockRepository.logout();
    await assert.rejects(mockRepository.createTopUpRequest(100), (error) => {
      assert.equal(error.code, "AUTH_REQUIRED");
      return true;
    });
    await assert.rejects(mockRepository.getMyTopUpRequests(), (error) => {
      assert.equal(error.code, "AUTH_REQUIRED");
      return true;
    });
  });

  await t.test("tolerates stores persisted before Story 6.6", async () => {
    const state = loadStore();
    delete state.topUpRequests;
    saveStore(state);

    assert.equal((await mockRepository.getMyTopUpRequests()).total, 0);
    const request = await mockRepository.createTopUpRequest(100);
    assert.equal(request.status, "PENDING");
  });

  await t.test("reset clears demo top-up requests", async () => {
    await mockRepository.createTopUpRequest(100);
    await mockRepository.resetDemo();
    await mockRepository.switchDemoUser("user-active-002");
    assert.equal((await mockRepository.getMyTopUpRequests()).total, 0);
  });
});
