import { JobRunContext } from './scheduled-job';

/**
 * Test helper (Story IR.2b): a job run context whose lease renewals answer
 * from `renewals` in order (default: always renewed).
 */
export function testJobContext(
  now: Date = new Date(),
  renewals: boolean[] = [],
): JobRunContext & { renewCalls: number } {
  const ctx = {
    runId: 'run-test',
    now,
    owner: 'owner-test',
    fencingToken: '1',
    renewCalls: 0,
    async shouldContinue(): Promise<boolean> {
      const answer = renewals[ctx.renewCalls] ?? true;
      ctx.renewCalls++;
      return answer;
    },
    logger: { log() {}, warn() {}, error() {}, debug() {} },
  };
  return ctx;
}
