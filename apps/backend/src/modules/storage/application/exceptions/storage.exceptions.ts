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
