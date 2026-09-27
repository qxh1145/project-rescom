// Prohibited dangerous extensions and MIME types
export const DANGEROUS_EXTENSIONS = [
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.dll',
  '.msi',
  '.com',
  '.scr',
  '.vbs',
  '.js',
  // Epic 5 review P17: mirrors part of the server extension denylist.
  '.mjs',
  '.html',
  '.htm',
  '.svg',
  '.ps1',
  '.jar',
  '.hta',
  '.php',
];

export const DISALLOWED_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-sh',
  'application/x-csh',
  'application/x-bat',
  'application/x-dosexec',
  'application/x-apple-diskimage',
  'application/x-sharedlib',
  'text/javascript',
  'application/javascript',
  'text/html',
  'application/xhtml+xml',
  // Epic 5 review P17: mirrors the server denylist (UX only; the server enforces).
  'image/svg+xml',
  'application/x-httpd-php',
  'application/java-archive',
];

export function isExecutableOrDangerous(fileName, mimeType) {
  if (fileName) {
    const lowerName = fileName.toLowerCase();
    for (const ext of DANGEROUS_EXTENSIONS) {
      if (lowerName.endsWith(ext)) {
        return true;
      }
    }
  }
  if (mimeType) {
    const lowerMime = mimeType.toLowerCase().trim();
    if (DISALLOWED_MIME_TYPES.includes(lowerMime)) {
      return true;
    }
  }
  return false;
}

export function validateFileConstraints(file, block) {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }

  // 1. Check dangerous file types
  if (isExecutableOrDangerous(file.name, file.type)) {
    return {
      valid: false,
      error: `${file.name}: Executable or script files are prohibited for security reasons.`,
    };
  }

  // 2. Check file size
  if (!Number.isInteger(file.size) || file.size <= 0) {
    return {
      valid: false,
      error: `${file.name}: File must contain at least one byte.`,
    };
  }
  const maxBytes = (block?.maxFileSizeMb || 10) * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `${file.name} (${formatBytes(file.size)}) exceeds the maximum allowed size of ${block.maxFileSizeMb}MB.`,
    };
  }

  // 3. Check allowed MIME types
  if (block?.allowedMimeTypes && block.allowedMimeTypes.length > 0) {
    const fileType = file.type || '';
    const isMatch = block.allowedMimeTypes.some((allowed) => {
      const normAllowed = allowed.toLowerCase().trim();
      if (normAllowed.endsWith('/*')) {
        const prefix = normAllowed.slice(0, -1);
        return fileType.toLowerCase().startsWith(prefix);
      }
      return fileType.toLowerCase() === normAllowed;
    });

    if (!isMatch) {
      return {
        valid: false,
        error: `${file.name} has file type "${fileType || 'unknown'}" which is not permitted. Allowed: ${block.allowedMimeTypes.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Number((bytes / 1024 ** i).toFixed(1))} ${units[i]}`;
}
