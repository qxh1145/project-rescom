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
  "image/svg+xml",
  "application/x-httpd-php",
  "application/java-archive",
];

/**
 * File names the server refuses (`StorageService.assertSafeExtension`), shared
 * so the runner and the mock reject them before any upload. Windows drops
 * trailing dots and spaces, so `evil.exe.` counts as `.exe`.
 */
export const DANGEROUS_FILE_EXTENSIONS: readonly string[] = [
  ".exe",
  ".dll",
  ".msi",
  ".msc",
  ".com",
  ".scr",
  ".bat",
  ".cmd",
  ".ps1",
  ".lnk",
  ".hta",
  ".jar",
  ".sh",
  ".csh",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".mjs",
  ".wsf",
  ".php",
  ".phtml",
  ".html",
  ".htm",
  ".xhtml",
  ".shtml",
  ".svg",
  ".svgz",
];

export const MAX_UPLOAD_FILE_NAME_LENGTH = 255;

/** The dangerous extension `fileName` ends with (case-insensitive), or null. */
export function dangerousFileExtension(fileName: string): string | null {
  const normalized = fileName.toLowerCase().replace(/[.\s]+$/, "");
  return (
    DANGEROUS_FILE_EXTENSIONS.find((extension) =>
      normalized.endsWith(extension),
    ) ?? null
  );
}

export type UploadFileNameProblem =
  "EMPTY" | "TOO_LONG" | "PATH" | "DANGEROUS_EXTENSION";

/** Why the server would refuse this file name, or null (same rules as initiate). */
export function uploadFileNameProblem(
  fileName: string,
): UploadFileNameProblem | null {
  const trimmed = fileName.trim();
  if (!trimmed || !trimmed.replace(/^\.+/, "")) return "EMPTY";
  if (trimmed.length > MAX_UPLOAD_FILE_NAME_LENGTH) return "TOO_LONG";
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
    return "PATH";
  return dangerousFileExtension(trimmed) ? "DANGEROUS_EXTENSION" : null;
}

/** 409 when a question already holds `maxFiles` live uploads (`details`: below). */
export const STORAGE_QUESTION_FULL_CODE = "STORAGE_QUESTION_FULL";

export const storageQuestionFullDetailsSchema = z.object({
  questionId: z.string().nullable(),
  maxFiles: z.number().int().positive(),
});

const sha256ChecksumSchema = z
  .string()
  .regex(
    /^[a-fA-F0-9]{64}$/,
    "Checksum must be a 64-character hex string (SHA-256)",
  );

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
          !name.includes("..") && !name.includes("/") && !name.includes("\\"),
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
    checksum: sha256ChecksumSchema.optional(),
  })
  .strict()
  // Participation uploads are always bound to a file-upload question of the
  // pinned form version, so the per-question policy is always enforced.
  .superRefine((input, ctx) => {
    if (input.ownerContext === "participation" && !input.questionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questionId"],
        message: "questionId is required for participation uploads",
      });
    }
  });

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
/** Request body of `POST uploads/:id/finalize` (the object id is a path param). */
export const finalizeUploadBodySchema = z
  .object({
    checksum: sha256ChecksumSchema.optional(),
  })
  .strict();

export type FinalizeUploadBody = z.infer<typeof finalizeUploadBodySchema>;

export const finalizeUploadInputSchema = finalizeUploadBodySchema
  .extend({
    objectId: z.string().uuid("Invalid object UUID"),
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

export type FileAttachmentAnswer = z.infer<typeof fileAttachmentAnswerSchema>;

// --- List an owner's live uploads (re-adopt / clean up, Phase 7) ---
/** `GET storage/uploads`: the caller's live uploads of one owner record (and question). */
export const listUploadsQuerySchema = z
  .object({
    ownerContext: storageOwnerContextEnum,
    ownerRecordId: z.string().uuid("Invalid owner record UUID"),
    questionId: z.string().max(100).optional(),
  })
  .strict();

export type ListUploadsQuery = z.infer<typeof listUploadsQuerySchema>;

export const listUploadsResponseSchema = z.object({
  objects: z.array(storedObjectDtoSchema),
});

export type ListUploadsResponse = z.infer<typeof listUploadsResponseSchema>;

/** `details` of a 400 `UNCLEAN_ATTACHMENT` at submit: the files that could not be attached. */
export const uncleanAttachmentDetailsSchema = z.object({
  files: z.array(z.object({ questionId: z.string(), objectId: z.string() })),
});

export type UncleanAttachmentDetails = z.infer<
  typeof uncleanAttachmentDetailsSchema
>;
