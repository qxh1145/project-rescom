import test from "node:test";
import assert from "node:assert/strict";

const { OTP_EMPTY_SLOT, isOtpComplete, otpSlots, typeIntoOtp } = await import("../components/ui/otp-slots.ts");

const _ = OTP_EMPTY_SLOT;

test("otpSlots reads a fixed number of boxes", () => {
  assert.deepEqual(otpSlots("", 4), ["", "", "", ""]);
  assert.deepEqual(otpSlots(`1${_}3${_}`, 4), ["1", "", "3", ""]);
  assert.deepEqual(otpSlots("12345678", 4), ["1", "2", "3", "4"]);
});

test("clearing box 2 does not shift the following digits", () => {
  const result = typeIntoOtp("123456", 6, 1, "");
  assert.equal(result.value, `1${_}3456`);
  assert.equal(result.focus, 1);
  assert.equal(result.value.length, 6);
  assert.equal(isOtpComplete(result.value, 6), false);
});

test("typing in box 4 first keeps it in box 4", () => {
  const result = typeIntoOtp("", 6, 3, "7");
  assert.equal(result.value, `${_}${_}${_}7${_}${_}`);
  assert.equal(result.focus, 4);
});

test("typing over a filled box replaces its digit", () => {
  assert.equal(typeIntoOtp("123456", 6, 2, "39").value, "129456");
  assert.equal(typeIntoOtp("123456", 6, 2, "93").value, "129456");
  assert.equal(typeIntoOtp("123456", 6, 2, "33").value, "123456");
});

test("a full paste fills every box from the first, wherever it lands", () => {
  const result = typeIntoOtp("", 6, 3, "98-76 54");
  assert.equal(result.value, "987654");
  assert.equal(result.focus, 5);
  assert.equal(isOtpComplete(result.value, 6), true);
});

test("a partial paste fills from the current box without overflowing", () => {
  const result = typeIntoOtp("", 6, 4, "123");
  assert.equal(result.value, `${_}${_}${_}${_}12`);
  assert.equal(result.focus, 5);
});

test("isOtpComplete requires every box to hold a digit", () => {
  assert.equal(isOtpComplete("123456", 6), true);
  assert.equal(isOtpComplete(`12345${_}`, 6), false);
  assert.equal(isOtpComplete("12345", 6), false);
});

test("letters are accepted and lowercased", () => {
  const result = typeIntoOtp("", 6, 0, "ABC-123");
  assert.equal(result.value, "abc123");
  assert.equal(isOtpComplete(result.value, 6), true);
});
