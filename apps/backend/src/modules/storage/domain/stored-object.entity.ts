import {
  StoredObjectStatus,
  StoredObjectScanStatus,
  StorageDataClass,
} from '@rescom/schemas';

export class StoredObjectEntity {
  constructor(
    public readonly id: string,
    public readonly ownerContext: string,
    public readonly ownerRecordId: string,
    public readonly dataClass: StorageDataClass,
    /**
     * Client-writable upload key while INITIATED or QUARANTINED (including a
     * scanner OUTAGE awaiting retry); once the bytes are verified and scanned
     * clean it points at the server-owned verified copy (Epic 5 review P10).
     */
    public storageKey: string,
    public readonly bucket: string,
    public readonly fileName: string,
    public readonly fileSize: number,
    public readonly mimeType: string,
    public checksum: string | null = null,
    public status: StoredObjectStatus = 'INITIATED',
    public scanStatus: StoredObjectScanStatus = 'PENDING',
    public scanPolicy: string | null = null,
    public scanResult: Record<string, unknown> | null = null,
    public uploadedAt: Date | null = null,
    public scannedAt: Date | null = null,
    public attachedAt: Date | null = null,
    public expiresAt: Date | null = null,
    public readonly createdAt: Date = new Date(),
    public updatedAt: Date = new Date(),
    public readonly questionId: string | null = null,
  ) {}

  /**
   * Transitions state from INITIATED to UPLOADED upon client upload completion.
   */
  markUploaded(checksum?: string): void {
    if (this.status !== 'INITIATED') {
      throw new Error(
        `Cannot mark object as uploaded from status: ${this.status}`,
      );
    }
    this.status = 'UPLOADED';
    this.uploadedAt = new Date();
    this.updatedAt = new Date();
    if (checksum) {
      this.checksum = checksum;
    }
  }

  /**
   * Enters quarantine before running malware scan (AD-22), or re-enters it to
   * retry a scan that hit a scanner OUTAGE. The storage key is left alone: the
   * bytes move to the verified key only once they are scanned clean.
   */
  markQuarantined(): void {
    const retryingOutage =
      this.status === 'QUARANTINED' && this.scanStatus === 'OUTAGE';
    if (
      this.status !== 'UPLOADED' &&
      this.status !== 'INITIATED' &&
      !retryingOutage
    ) {
      throw new Error(`Cannot quarantine object from status: ${this.status}`);
    }
    this.status = 'QUARANTINED';
    this.scanStatus = 'PENDING';
    this.uploadedAt = this.uploadedAt ?? new Date();
    this.updatedAt = new Date();
  }

  /**
   * Transitions to CLEAN if malware scan verifies safety.
   */
  markClean(policy: string, result?: Record<string, unknown>): void {
    if (this.status !== 'QUARANTINED' && this.status !== 'UPLOADED') {
      throw new Error(`Cannot mark clean from status: ${this.status}`);
    }
    this.status = 'CLEAN';
    this.scanStatus = 'CLEAN';
    this.scanPolicy = policy;
    this.scanResult = result ?? { verified: true };
    this.scannedAt = new Date();
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    this.updatedAt = new Date();
  }

  /**
   * Rejects object if malware or malicious payload is detected.
   */
  markInfected(policy: string, reason: string): void {
    this.status = 'REJECTED';
    this.scanStatus = 'INFECTED';
    this.scanPolicy = policy;
    this.scanResult = { infectionReason: reason };
    this.scannedAt = new Date();
    this.updatedAt = new Date();
  }

  /**
   * Rejects a quarantined object whose bytes failed server-side verification
   * (changed during finalization, wrong signature or checksum). No scan ran.
   */
  markRejected(reason: string): void {
    if (this.status !== 'QUARANTINED') {
      throw new Error(`Cannot reject object from status: ${this.status}`);
    }
    this.status = 'REJECTED';
    this.scanStatus = 'SKIPPED';
    this.scanResult = { rejectionReason: reason };
    this.updatedAt = new Date();
  }

  /**
   * Fails closed when malware scanner is unavailable or experiences an outage (AD-22).
   * Object remains QUARANTINED at its upload key with scanStatus OUTAGE, so
   * finalization can be retried once the scanner recovers.
   */
  markScanOutage(policy: string, errorDetails: string): void {
    this.status = 'QUARANTINED';
    this.scanStatus = 'OUTAGE';
    this.scanPolicy = policy;
    this.scanResult = { scannerOutage: errorDetails };
    this.scannedAt = new Date();
    this.updatedAt = new Date();
  }

  /**
   * Attaches object to response or domain record.
   * Only CLEAN objects can ever become ATTACHED (AD-22).
   */
  markAttached(): void {
    if (this.status !== 'CLEAN') {
      throw new Error(
        `Only CLEAN objects may become ATTACHED. Current status: ${this.status}`,
      );
    }
    this.status = 'ATTACHED';
    this.attachedAt = new Date();
    this.expiresAt = null;
    this.updatedAt = new Date();
  }

  markDeleted(): void {
    if (this.status === 'ATTACHED') {
      throw new Error(
        'Attached objects cannot be deleted through upload cleanup',
      );
    }
    this.status = 'DELETED';
    this.updatedAt = new Date();
  }

  markExpired(): void {
    if (this.status === 'ATTACHED' || this.status === 'DELETED') return;
    this.status = 'EXPIRED';
    this.updatedAt = new Date();
  }

  /**
   * Checks if the object is safe and authorized for downloading.
   * Only CLEAN or ATTACHED objects may be downloaded (AD-22).
   */
  isDownloadable(): boolean {
    return (
      (this.status === 'CLEAN' || this.status === 'ATTACHED') &&
      this.scanStatus === 'CLEAN'
    );
  }
}
