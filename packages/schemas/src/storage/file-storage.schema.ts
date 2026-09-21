import { z } from "zod";

// Prohibited dangerous MIME types that could carry active or executable content
export const DISALLOWED_MIME_TYPES = [
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-sh",
  "application/x-csh",
  "application/x-bat",
  "application/x-dosexec",
  "application/x-apple-diskimage",
  "application/x-sharedlib",
  "text/javascript",
  "application/javascript",
  "text/html",
  "application/xhtml+xml",
];

// --- Enums ---
export const storedObjectStatusEnum = z.enum([
  "INITIATED",
  "UPLOADED",
  "QUARANTINED",
  "CLEAN",
  "ATTACHED",
  "REJECTED",
  "EXPIRED",
  "DELETED",
]);
export type StoredObjectStatus = z.infer<typeof storedObjectStatusEnum>;

export const storedObjectScanStatusEnum = z.enum([
  "PENDING",
  "CLEAN",
  "INFECTED",
  "OUTAGE",
  "SKIPPED",
]);
export type StoredObjectScanStatus = z.infer<typeof storedObjectScanStatusEnum>;

export const storageDataClassEnum = z.enum([
  "SURVEY_ATTACHMENT",
  "EVIDENCE",
  "EXPORT",
]);
export type StorageDataClass = z.infer<typeof storageDataClassEnum>;

export const storageOwnerContextEnum = z.enum([
  "participation",
  "forms",
  "research",
]);
export type StorageOwnerContext = z.infer<typeof storageOwnerContextEnum>;

// --- Initiate Upload Schema ---
export const initiateUploadInputSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1, "File name must not be empty")
      .max(255, "File name must not exceed 255 characters")
      .refine(
        (name) =>
          !name.includes("..") &&
          !name.includes("/") &&
          !name.includes("\\"),
        "File name contains invalid path traversal characters",
      ),
    fileSize: z
      .number()
      .int()
      .positive("File size must be a positive number of bytes")
      .max(50 * 1024 * 1024, "File size exceeds maximum allowed limit of 50MB"),
    mimeType: z
      .string()
      .trim()
      .regex(/^[-\w.]+\/[-\w.+]+$/, "Invalid MIME type format")
      .refine(
        (mime) => !DISALLOWED_MIME_TYPES.includes(mime.toLowerCase()),
        "File type is not permitted for security reasons",
      ),
    ownerContext: storageOwnerContextEnum,
    ownerRecordId: z.string().uuid("Invalid owner record UUID"),
    questionId: z.string().max(100).optional(),
    checksum: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, "Checksum must be a 64-character hex string (SHA-256)")
      .optional(),
  })
  .strict();

export type InitiateUploadInput = z.infer<typeof initiateUploadInputSchema>;

export const initiateUploadResponseSchema = z.object({
  objectId: z.string().uuid(),
  uploadUrl: z.string(),
  storageKey: z.string(),
  expiresAt: z.string(),
  headers: z.record(z.string()).optional(),
});

export type InitiateUploadResponse = z.infer<
  typeof initiateUploadResponseSchema
>;

// --- Finalize Upload Schema ---
export const finalizeUploadInputSchema = z
  .object({
    objectId: z.string().uuid("Invalid object UUID"),
    checksum: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, "Checksum must be a 64-character hex string (SHA-256)")
      .optional(),
  })
  .strict();

export type FinalizeUploadInput = z.infer<typeof finalizeUploadInputSchema>;

// --- Stored Object DTO Schema ---
export const storedObjectDtoSchema = z.object({
  id: z.string().uuid(),
  ownerContext: z.string(),
  ownerRecordId: z.string().uuid(),
  dataClass: storageDataClassEnum,
  storageKey: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  status: storedObjectStatusEnum,
  scanStatus: storedObjectScanStatusEnum,
  checksum: z.string().nullable().optional(),
  createdAt: z.string(),
  uploadedAt: z.string().nullable().optional(),
  scannedAt: z.string().nullable().optional(),
  attachedAt: z.string().nullable().optional(),
});

export type StoredObjectDto = z.infer<typeof storedObjectDtoSchema>;

// --- Download URL Response Schema ---
export const getDownloadUrlResponseSchema = z.object({
  objectId: z.string().uuid(),
  downloadUrl: z.string(),
  expiresAt: z.string(),
  fileName: z.string(),
});

export type GetDownloadUrlResponse = z.infer<
  typeof getDownloadUrlResponseSchema
>;

export const fileAttachmentAnswerSchema = z.object({
  objectId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.string().regex(/^[-\w.]+\/[-\w.+]+$/),
  status: z.literal("CLEAN"),
});

export type FileAttachmentAnswer = z.infer<
  typeof fileAttachmentAnswerSchema
>;
