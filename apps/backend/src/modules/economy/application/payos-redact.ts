export function redactPayosPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayosPayload);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => {
      if (
        /^(accountNumber|counterAccountNumber|virtualAccountNumber)$/.test(key)
      ) {
        if (!field) return [key, null];
        const digits = String(field);
        return [key, digits.length < 4 ? '****' : `****${digits.slice(-4)}`];
      }
      if (/^(accountName|counterAccountName|virtualAccountName)$/.test(key))
        return [key, field ? `${String(field)[0]}***` : null];
      return [key, redactPayosPayload(field)];
    }),
  );
}
