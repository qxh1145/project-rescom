import { InMemorySessionRepository } from './in-memory-session.repository';
import {
  CreateIdentityAuditRecord,
  IdentityAuditPort,
} from '../application/ports/identity-audit.port';
import { SessionProps, RefreshCredentialProps } from '../domain/session.entity';
import { ReplaceUserSessionInput } from '../application/ports/session-repository.port';

class MockIdentityAuditPort implements IdentityAuditPort {
  records: CreateIdentityAuditRecord[] = [];
  async append(record: CreateIdentityAuditRecord): Promise<void> {
    this.records.push(record);
  }
}

describe('SessionRepository (Task 2 Concurrency & Versioning)', () => {
  let repository: InMemorySessionRepository;
  let auditPort: MockIdentityAuditPort;

  beforeEach(() => {
    auditPort = new MockIdentityAuditPort();
    repository = new InMemorySessionRepository(auditPort);
  });

  function createSampleInput(
    sessionId: string,
    credentialId: string,
    userId: string,
  ): ReplaceUserSessionInput {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const session: Omit<SessionProps, 'sessionVersion'> = {
      id: sessionId,
      userId,
      csrfDigest: 'csrf-digest-' + sessionId,
      revoked: false,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    const credential: RefreshCredentialProps = {
      id: credentialId,
      sessionId,
      secretDigest: 'secret-digest-' + credentialId,
      isUsed: false,
      usedAt: null,
      expiresAt,
      createdAt: now,
    };
    const audit: CreateIdentityAuditRecord = {
      action: 'SESSION_REPLACED',
      userId,
      outcome: 'SUCCESS',
      metadata: { sessionId },
    };
    return { session, credential, audit };
  }

  it('should monotonically increment sessionVersion and revoke prior sessions', async () => {
    const userId = '11111111-1111-1111-1111-111111111111';

    // 1st login
    const session1 = await repository.replaceUserSession(
      userId,
      createSampleInput('s1', 'c1', userId),
    );
    expect(session1.sessionVersion).toBe(1);
    expect(session1.revoked).toBe(false);

    // 2nd login
    const session2 = await repository.replaceUserSession(
      userId,
      createSampleInput('s2', 'c2', userId),
    );
    expect(session2.sessionVersion).toBe(2);
    expect(session2.revoked).toBe(false);

    // Old session must be revoked
    const fetchedS1 = await repository.findById('s1');
    expect(fetchedS1?.revoked).toBe(true);

    // 3rd login after revoking session 2
    await repository.revokeSession('s2');
    const session3 = await repository.replaceUserSession(
      userId,
      createSampleInput('s3', 'c3', userId),
    );
    expect(session3.sessionVersion).toBe(3);
    expect(session3.revoked).toBe(false);
  });

  it('should serialize concurrent replaceUserSession calls and produce distinct consecutive versions', async () => {
    const userId = '22222222-2222-2222-2222-222222222222';

    const inputA = createSampleInput('s-a', 'c-a', userId);
    const inputB = createSampleInput('s-b', 'c-b', userId);

    const [resA, resB] = await Promise.all([
      repository.replaceUserSession(userId, inputA),
      repository.replaceUserSession(userId, inputB),
    ]);

    const versions = [resA.sessionVersion, resB.sessionVersion].sort(
      (a, b) => a - b,
    );
    expect(versions).toEqual([1, 2]);

    // Check active sessions in repository: exactly 1 must be unrevoked
    const storedA = await repository.findById('s-a');
    const storedB = await repository.findById('s-b');

    const activeCount = [storedA, storedB].filter(
      (s) => s && !s.revoked,
    ).length;
    expect(activeCount).toBe(1);

    // Both replacement audit records must be recorded with committed versions
    expect(auditPort.records.length).toBe(2);
    const auditVersions = auditPort.records
      .map((r) => (r.metadata as { sessionVersion?: number })?.sessionVersion)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(auditVersions).toEqual([1, 2]);
  });
});
