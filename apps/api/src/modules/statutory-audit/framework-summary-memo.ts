import type { PoolClient } from 'pg';
import type { FrameworkMemoCard } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';

/**
 * 02.8 §10–§11 — the Audit Framework Memorandum file card of one baseline
 * version (Track B). DI-free. PLACEHOLDER.
 */
export async function readFrameworkMemoOn(
  _client: PoolClient,
  _workflowInstanceId: string,
  _baselineId: string | null,
): Promise<FrameworkMemoCard | null> {
  return null;
}

/**
 * Called by AF-02 approval inside its transaction: the submitted memorandum
 * becomes the controlled approved version (§11). Returns its version/reference
 * for the approval record. PLACEHOLDER.
 */
export async function controlFrameworkMemoOn(
  _client: PoolClient,
  _ctx: RlsContext,
  _baselineId: string,
): Promise<{ documentId: string; version: string | null; reference: string | null } | null> {
  return null;
}

/** Called by AF-02 "Return for Further Work": a submitted memo goes back to draft. PLACEHOLDER. */
export async function returnFrameworkMemoOn(
  _client: PoolClient,
  _ctx: RlsContext,
  _baselineId: string,
): Promise<void> {}
