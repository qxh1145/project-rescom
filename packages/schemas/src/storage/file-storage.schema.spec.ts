import {
  initiateUploadInputSchema,
  finalizeUploadInputSchema,
  storedObjectStatusEnum,
  storedObjectScanStatusEnum,
  storageDataClassEnum,
  DISALLOWED_MIME_TYPES,
} from "./file-storage.schema";

describe("File Storage Schemas", () => {
  const validUUID = "11111111-1111-4111-8111-111111111111";

  describe("initiateUploadInputSchema", () => {
    it("should accept valid upload input", () => {
      const valid = {
        fileName: "survey_receipt.pdf",
        fileSize: 1024 * 500, // 500KB
        mimeType: "application/pdf",
        ownerContext: "participation",
        ownerRecordId: validUUID,
        questionId: "block-file-1",
        checksum:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      };

      const parsed = initiateUploadInputSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it("should reject path traversal in fileName", () => {
      const invalidTraversal = {
        fileName: "../../../etc/passwd",
        fileSize: 1024,
        mimeType: "image/png",
        ownerContext: "participation",
        ownerRecordId: validUUID,
      };

      const result = initiateUploadInputSchema.safeParse(invalidTraversal);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain(
          "path traversal characters",
        );
      }
    });

    it("should reject prohibited executable MIME types", () => {
      for (const dangerousMime of DISALLOWED_MIME_TYPES) {
        const payload = {
          fileName: "malicious.exe",
          fileSize: 1024,
          mimeType: dangerousMime,
          ownerContext: "participation",
          ownerRecordId: validUUID,
        };

        const result = initiateUploadInputSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });

    it("should reject file sizes exceeding 50MB", () => {
      const payload = {
        fileName: "huge_file.zip",
        fileSize: 55 * 1024 * 1024, // 55MB
        mimeType: "application/zip",
        ownerContext: "participation",
        ownerRecordId: validUUID,
      };

      const result = initiateUploadInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it("should reject invalid ownerContext", () => {
      const payload = {
        fileName: "photo.jpg",
        fileSize: 1024,
        mimeType: "image/jpeg",
        ownerContext: "invalid_context",
        ownerRecordId: validUUID,
      };

      const result = initiateUploadInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("finalizeUploadInputSchema", () => {
    it("should accept valid finalize input with valid UUID", () => {
      const valid = {
        objectId: validUUID,
        checksum:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      };

      const result = finalizeUploadInputSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject non-UUID objectId", () => {
      const invalid = {
        objectId: "not-a-uuid",
      };

      const result = finalizeUploadInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("Enums", () => {
    it("should support the full AD-22 lifecycle states", () => {
      expect(storedObjectStatusEnum.options).toEqual([
        "INITIATED",
        "UPLOADED",
        "QUARANTINED",
        "CLEAN",
        "ATTACHED",
        "REJECTED",
        "EXPIRED",
        "DELETED",
      ]);

      expect(storedObjectScanStatusEnum.options).toEqual([
        "PENDING",
        "CLEAN",
        "INFECTED",
        "OUTAGE",
        "SKIPPED",
      ]);

      expect(storageDataClassEnum.options).toEqual([
        "SURVEY_ATTACHMENT",
        "EVIDENCE",
        "EXPORT",
      ]);
    });
  });
});
