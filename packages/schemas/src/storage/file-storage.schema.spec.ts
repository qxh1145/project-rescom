import {
  initiateUploadInputSchema,
  finalizeUploadBodySchema,
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
        questionId: "block-file-1",
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
          questionId: "block-file-1",
        };

        const result = initiateUploadInputSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });

    it("should deny SVG, PHP and Java-archive MIME types (Epic 5 review P17)", () => {
      expect(DISALLOWED_MIME_TYPES).toEqual(
        expect.arrayContaining([
          "image/svg+xml",
          "application/x-httpd-php",
          "application/java-archive",
        ]),
      );
      for (const mimeType of ["image/svg+xml", "IMAGE/SVG+XML"]) {
        const result = initiateUploadInputSchema.safeParse({
          fileName: "vector.png",
          fileSize: 1024,
          mimeType,
          ownerContext: "participation",
          ownerRecordId: validUUID,
          questionId: "block-file-1",
        });
        expect(result.success).toBe(false);
      }
    });

    it("should require questionId for participation uploads (Epic 5 review P4)", () => {
      const base = {
        fileName: "report.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        ownerRecordId: validUUID,
      };

      for (const questionId of [undefined, ""]) {
        const result = initiateUploadInputSchema.safeParse({
          ...base,
          ownerContext: "participation",
          ...(questionId === undefined ? {} : { questionId }),
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toEqual(["questionId"]);
          expect(result.error.issues[0].message).toContain(
            "questionId is required",
          );
        }
      }

      expect(
        initiateUploadInputSchema.safeParse({ ...base, ownerContext: "forms" })
          .success,
      ).toBe(true);
    });

    it("should still reject unknown fields", () => {
      const result = initiateUploadInputSchema.safeParse({
        fileName: "report.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        ownerContext: "participation",
        ownerRecordId: validUUID,
        questionId: "block-file-1",
        storageKey: "attacker/chosen/key",
      });
      expect(result.success).toBe(false);
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

    it("should accept an empty finalize body and reject unknown or malformed fields", () => {
      expect(finalizeUploadBodySchema.safeParse({}).success).toBe(true);
      expect(
        finalizeUploadBodySchema.safeParse({ checksum: "a".repeat(64) })
          .success,
      ).toBe(true);
      expect(
        finalizeUploadBodySchema.safeParse({ checksum: "not-a-sha256" })
          .success,
      ).toBe(false);
      expect(
        finalizeUploadBodySchema.safeParse({ status: "CLEAN" }).success,
      ).toBe(false);
      expect(
        finalizeUploadInputSchema.safeParse({ objectId: validUUID, extra: 1 })
          .success,
      ).toBe(false);
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
