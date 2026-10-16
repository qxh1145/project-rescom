/** RFC 4180 quoted CSV with Excel formula protection on text cells. */
export function toCsv(
  header: string[],
  rows: (string | number | null)[][],
): string {
  const cell = (value: string | number | null): string => {
    const text =
      typeof value === 'string' && /^[=+\-@\t\r\n]/.test(value)
        ? `'${value}`
        : String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };
  return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
