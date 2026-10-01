/**
 * Forms-owned title lookup for admin read views (FraudLog, ledger journals):
 * the survey a piece of evidence or a journal is about, by form id or by form
 * version id. Callers pass bounded id lists (one page of rows).
 */
export const FORM_TITLE_LOOKUP_PORT = Symbol('FORM_TITLE_LOOKUP_PORT');

export interface FormTitleLookupResult {
  /** form id → title */
  byFormId: Map<string, string>;
  /** form version id → its form id and title */
  byFormVersionId: Map<string, { formId: string; title: string }>;
}

export interface FormTitleLookupPort {
  findTitles(params: {
    formIds: readonly string[];
    formVersionIds: readonly string[];
  }): Promise<FormTitleLookupResult>;
}
