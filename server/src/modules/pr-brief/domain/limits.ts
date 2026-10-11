/**
 * PR Brief limits (AC-33, AC-34). One place, tunable without a spec change.
 */

/** Input bounds: what the model may receive. */
export const MAX_DESCRIPTION_CHARS = 8_000;
export const MAX_FILES = 50;
export const MAX_CALLER_FILES = 30;
export const MAX_FINDINGS = 30;
/** Attached documents are sent whole, in order, up to this many tokens in total. */
export const MAX_DOCUMENT_TOKENS = 30_000;

/** Longest path/line of untrusted file text sent to the model. */
export const MAX_PATH_CHARS = 300;

/** Output bounds: what is stored. */
export const MAX_SUMMARY_CHARS = 600;
export const MAX_RISKS = 5;
export const MAX_RISK_TITLE_CHARS = 100;
export const MAX_RISK_FILE_REFS = 3;
export const MAX_FOCUS_ITEMS = 5;
export const MAX_FOCUS_REASON_CHARS = 240;
/** Generous bounds for the explanation and kind (stored, shown only in P3). */
export const MAX_RISK_EXPLANATION_CHARS = 600;
export const MAX_RISK_KIND_CHARS = 60;
