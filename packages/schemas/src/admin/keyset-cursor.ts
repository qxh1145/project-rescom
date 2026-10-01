import { z } from "zod";

/**
 * Keyset cursor of the admin read lists (newest first, ties by id
 * descending): `<createdAt ISO>:<id>` of the last row already shown, so a row
 * written between two pages can neither shift nor repeat rows.
 */
export interface KeysetPosition {
  createdAt: string;
  id: string;
}

const isoInstant = z.string().datetime();
const rowId = z.string().uuid();

export function keysetCursorOf(row: { createdAt: string | Date; id: string }): string {
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  return `${createdAt}:${row.id}`;
}

/** Splits at the last colon (ISO times contain colons, ids do not); null when malformed. */
export function parseKeysetCursor(cursor: string): KeysetPosition | null {
  const at = cursor.lastIndexOf(":");
  if (at <= 0 || at === cursor.length - 1) return null;
  const createdAt = cursor.slice(0, at);
  const id = cursor.slice(at + 1);
  if (!isoInstant.safeParse(createdAt).success || !rowId.safeParse(id).success) return null;
  return { createdAt, id };
}

export const keysetCursorSchema = z
  .string()
  .max(100)
  .refine((value) => parseKeysetCursor(value) !== null, "Invalid cursor");
