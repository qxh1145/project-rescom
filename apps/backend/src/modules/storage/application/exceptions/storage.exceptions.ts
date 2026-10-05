export class StorageObjectNotFoundException extends Error {
  readonly code = 'STORAGE_OBJECT_NOT_FOUND';

  constructor(message = 'Stored object not found.') {
    super(message);
    this.name = 'StorageObjectNotFoundException';
  }
}

export class StorageInvalidFileException extends Error {
  readonly code = 'STORAGE_INVALID_FILE';

  constructor(
    message = 'Invalid file upload metadata or disallowed file type.',
  ) {
    super(message);
    this.name = 'StorageInvalidFileException';
  }
}

export class StorageObjectNotCleanException extends Error {
  readonly code = 'STORAGE_OBJECT_NOT_CLEAN';

  constructor(
    message = 'Object is not clean. Only verified clean objects may be attached or downloaded.',
  ) {
    super(message);
    this.name = 'StorageObjectNotCleanException';
  }
}

export class StorageUnauthorizedAccessException extends Error {
  readonly code = 'STORAGE_UNAUTHORIZED';

  constructor(message = 'Unauthorized access to requested object.') {
    super(message);
    this.name = 'StorageUnauthorizedAccessException';
  }
}

export class StorageScannerOutageException extends Error {
  readonly code = 'STORAGE_SCANNER_OUTAGE';

  constructor(
    message = 'Malware scanner outage. Upload remains quarantined and fails closed per security policy.',
  ) {
    super(message);
    this.name = 'StorageScannerOutageException';
  }
}

/**
 * Story IR.5 C2.1: private storage could not be reached before the upload was
 * claimed. The object stays INITIATED, so finalize is retryable; fails closed
 * (nothing is attached or downloadable) as a 503.
 */
export class StorageUnavailableException extends Error {
  readonly code = 'STORAGE_UNAVAILABLE';

  constructor(
    message = 'Private storage is temporarily unavailable. Retry the upload finalization shortly.',
  ) {
    super(message);
    this.name = 'StorageUnavailableException';
  }
}

/**
 * The question already holds `maxFiles` live uploads (mock-off Phase 7): a
 * stable code so the runner can tell the respondent to remove a file — or
 * list and re-adopt the attempt's uploads (`GET storage/uploads`) — instead
 * of a generic invalid-file error.
 */
export class StorageQuestionFullException extends Error {
  readonly code = 'STORAGE_QUESTION_FULL';

  constructor(
    readonly questionId: string | null,
    readonly maxFiles: number,
  ) {
    super(`This question allows at most ${maxFiles} uploaded file(s).`);
    this.name = 'StorageQuestionFullException';
  }
}
