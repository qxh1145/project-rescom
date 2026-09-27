import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFileConstraints,
  isExecutableOrDangerous,
  formatBytes,
} from "../app/forms/hooks/file-upload-handler.mjs";

test("File Upload Handler Unit Tests", async (t) => {
  const sampleBlock = {
    id: "upload-1",
    type: "file_upload",
    title: "Upload supporting documents",
    maxFileSizeMb: 5,
    allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
    maxFiles: 3,
  };

  await t.test("accepts valid files within size and type limits", () => {
    const validFile = {
      name: "report.pdf",
      size: 2 * 1024 * 1024, // 2MB
      type: "application/pdf",
    };

    const res = validateFileConstraints(validFile, sampleBlock);
    assert.strictEqual(res.valid, true);
  });

  await t.test("rejects files exceeding maxFileSizeMb", () => {
    const oversized = {
      name: "big_scan.png",
      size: 6 * 1024 * 1024, // 6MB > 5MB limit
      type: "image/png",
    };

    const res = validateFileConstraints(oversized, sampleBlock);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /exceeds the maximum allowed size of 5MB/);
  });

  await t.test("rejects zero-byte files before upload initiation", () => {
    const empty = { name: "empty.pdf", size: 0, type: "application/pdf" };
    const res = validateFileConstraints(empty, sampleBlock);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /at least one byte/);
  });

  await t.test("rejects files not matching allowedMimeTypes", () => {
    const wrongType = {
      name: "audio.mp3",
      size: 1024 * 500,
      type: "audio/mpeg",
    };

    const res = validateFileConstraints(wrongType, sampleBlock);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /not permitted/);
  });

  await t.test("rejects dangerous executable files even if MIME is spoofed", () => {
    const malware = {
      name: "virus.exe",
      size: 1024,
      type: "image/png",
    };

    const res = validateFileConstraints(malware, sampleBlock);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /Executable or script files are prohibited/);
  });

  await t.test("supports wildcard MIME types such as image/*", () => {
    const wildcardBlock = {
      maxFileSizeMb: 10,
      allowedMimeTypes: ["image/*"],
    };

    const jpeg = { name: "pic.jpg", size: 1024, type: "image/jpeg" };
    const png = { name: "pic.png", size: 1024, type: "image/png" };
    const text = { name: "notes.txt", size: 1024, type: "text/plain" };

    assert.strictEqual(validateFileConstraints(jpeg, wildcardBlock).valid, true);
    assert.strictEqual(validateFileConstraints(png, wildcardBlock).valid, true);
    assert.strictEqual(validateFileConstraints(text, wildcardBlock).valid, false);
  });

  await t.test("isExecutableOrDangerous detects dangerous extensions and MIME types", () => {
    assert.strictEqual(isExecutableOrDangerous("script.sh", "text/plain"), true);
    assert.strictEqual(isExecutableOrDangerous("app.dll", "application/octet-stream"), true);
    assert.strictEqual(isExecutableOrDangerous("page.html", "text/html"), true);
    assert.strictEqual(isExecutableOrDangerous("photo.jpg", "image/jpeg"), false);
  });

  await t.test("formatBytes returns correct unit strings", () => {
    assert.strictEqual(formatBytes(0), "0 B");
    assert.strictEqual(formatBytes(1024), "1 KB");
    assert.strictEqual(formatBytes(1024 * 1024 * 2.5), "2.5 MB");
  });
});

test('Epic 5 review P17: client denylist mirrors the new server entries', () => {
  assert.equal(isExecutableOrDangerous('logo.svg', 'image/svg+xml'), true);
  assert.equal(isExecutableOrDangerous('shell.php', 'text/plain'), true);
  assert.equal(isExecutableOrDangerous('app.jar', 'application/java-archive'), true);
  assert.equal(isExecutableOrDangerous('report.pdf', 'application/pdf'), false);
});
