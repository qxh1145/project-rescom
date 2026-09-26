/**
 * Where the External completion credit of an attempt stands (Epic 9 review
 * P3). Implemented by Economy's `RewardSettlementCoordinator`
 * (`getExternalCreditState`); Participation depends only on this shape.
 * `REVERSED` = the credit was reversed (the Phase 1 upheld-dispute outcome).
 */
export type ExternalCreditStateValue =
  'NONE' | 'PENDING' | 'RELEASED' | 'REVERSED';

export interface ExternalCreditStatePort {
  getExternalCreditState(attemptId: string): Promise<ExternalCreditStateValue>;
}
