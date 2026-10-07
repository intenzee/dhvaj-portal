import type { AcceptanceConclusion } from './statutory-audit-acceptance';
import type { SignOffCheck } from './statutory-audit-completion';

/**
 * Sections 01–04 drafted from the file — the same shape as the Section 09/10
 * packs. Each check carries the facts behind it and, when not met, where it is
 * put right. Blocking checks are exactly the server's approval rule for the
 * section, so `ready` matches what the approve endpoint enforces.
 */
export interface SectionPack {
  checks: SignOffCheck[];
  /** Every blocking check is met. */
  ready: boolean;
  /** Advisory checks not met (never block). */
  attention: number;
  /** Draft approval memo, recorded when the approver leaves the memo blank. Null when the section has no approval. */
  draftMemo: string | null;
}

/** Section 01 also proposes the partner's conclusion from the answers. */
export interface AcceptancePack extends SectionPack {
  suggestedConclusion: AcceptanceConclusion;
}
