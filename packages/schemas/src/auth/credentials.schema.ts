import { z } from 'zod';

const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_GRAPHEMES = 12;
const graphemeSegmenter = new Intl.Segmenter('en', {
  granularity: 'grapheme',
});

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function isWithinPasswordByteLimit(value: string): boolean {
  return new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES;
}

function hasValidEmailPartLengths(value: string): boolean {
  const separatorIndex = value.lastIndexOf('@');
  if (separatorIndex < 0) {
    return false;
  }

  const localPart = value.slice(0, separatorIndex);
  const domainLabels = value.slice(separatorIndex + 1).split('.');

  return (
    localPart.length <= 64 && domainLabels.every((label) => label.length <= 63)
  );
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email must not exceed 254 characters')
  .email('Invalid email address format')
  .refine(
    hasValidEmailPartLengths,
    'Email local part or domain label is too long',
  );

const wellFormedPasswordSchema = z
  .string()
  .refine(isWellFormedUtf16, 'Password contains invalid Unicode');

export const registerPasswordSchema = wellFormedPasswordSchema
  .refine(
    (value) =>
      Array.from(graphemeSegmenter.segment(value)).length >=
      MIN_PASSWORD_GRAPHEMES,
    'Password must be at least 12 characters',
  )
  .refine(isWithinPasswordByteLimit, 'Password must not exceed 72 UTF-8 bytes');

export const loginPasswordSchema = wellFormedPasswordSchema
  .refine((value) => value.length > 0, 'Password is required')
  .refine(isWithinPasswordByteLimit, 'Password must not exceed 72 UTF-8 bytes');
