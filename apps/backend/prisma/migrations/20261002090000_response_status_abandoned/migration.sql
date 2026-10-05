-- Responses of cancelled/expired attempts move to ABANDONED (additive enum value).
ALTER TYPE "ResponseStatus" ADD VALUE IF NOT EXISTS 'ABANDONED';
