import type { PoolClient } from 'pg';
import { AUDIT_PHASES, AUDIT_PHASE_KEY } from '@hsdg/contracts';
import { StatutoryAuditWorkflowService } from './statutory-audit-workflow.service';
import type { DatabaseService } from '../../database/database.service';
import type { AuditService } from '../audit/audit.service';
import type { RlsContext } from '../../database/rls-context';

const ctx: RlsContext = { userId: 'u1', role: 'manager', employeeId: 'e1' };

/** A PoolClient stub whose query() is driven by an ordered script of results. */
function scriptedClient(results: Array<{ rows: unknown[]; rowCount?: number }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve(results[i++] ?? { rows: [] });
  });
  return { client: { query } as unknown as PoolClient, calls };
}

describe('AUDIT_PHASES catalogue (§8)', () => {
  it('defines exactly the ten canonical phases in order', () => {
    expect(AUDIT_PHASES).toHaveLength(10);
    expect(AUDIT_PHASES.map((p) => p.phaseNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(AUDIT_PHASES.map((p) => p.phaseKey)).toEqual([
      AUDIT_PHASE_KEY.acceptance,
      AUDIT_PHASE_KEY.framework,
      AUDIT_PHASE_KEY.planning,
      AUDIT_PHASE_KEY.risk,
      AUDIT_PHASE_KEY.controls,
      AUDIT_PHASE_KEY.auditAreas,
      AUDIT_PHASE_KEY.completion,
      AUDIT_PHASE_KEY.reporting,
      AUDIT_PHASE_KEY.signOff,
      AUDIT_PHASE_KEY.archiving,
    ]);
  });

  it('seeds no locked phases (Acceptance opens; everything else not started)', () => {
    const state = (key: string) => AUDIT_PHASES.find((p) => p.phaseKey === key)!.initialState;
    expect(state('acceptance')).toBe('in_progress');
    expect(
      AUDIT_PHASES.filter((p) => p.phaseKey !== 'acceptance').map((p) => p.initialState),
    ).toEqual(Array(9).fill('not_started'));
  });
});

describe('StatutoryAuditWorkflowService.provision', () => {
  const audit = { recordWith: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const db = {} as DatabaseService;

  beforeEach(() => jest.clearAllMocks());

  it('creates the shell, seeds ten phases and records one audit event on first add', async () => {
    const svc = new StatutoryAuditWorkflowService(db, audit);
    const { client, calls } = scriptedClient([
      { rows: [] }, // no cancelled file to restore
      { rows: [{ id: 'wf1' }] }, // INSERT ... RETURNING id (created)
      { rows: [] }, // INSERT phases
    ]);

    const result = await svc.provision(client, ctx, {
      engagementServiceId: 'es1',
      engagementId: 'eng1',
    });

    expect(result).toEqual({ workflowInstanceId: 'wf1', created: true });
    // Phase insert carries the workflow id, engagement id, then 5 params per phase.
    const phaseInsert = calls.find((c) => c.sql.includes('INTO hsdg.audit_workflow_phases'))!;
    expect(phaseInsert).toBeDefined();
    expect(phaseInsert.params.slice(0, 2)).toEqual(['wf1', 'eng1']);
    expect(phaseInsert.params).toHaveLength(2 + AUDIT_PHASES.length * 5);
    expect(audit.recordWith).toHaveBeenCalledTimes(1);
    expect((audit.recordWith as jest.Mock).mock.calls[0][2].action).toBe(
      'statutory_audit.workflow_provisioned',
    );
  });

  it('is idempotent — a repeat add writes no phases and no audit event', async () => {
    const svc = new StatutoryAuditWorkflowService(db, audit);
    const { client, calls } = scriptedClient([
      { rows: [] }, // no cancelled file to restore
      { rows: [] }, // INSERT ... ON CONFLICT DO NOTHING → no row
      { rows: [{ id: 'wf1' }] }, // SELECT existing id
    ]);

    const result = await svc.provision(client, ctx, {
      engagementServiceId: 'es1',
      engagementId: 'eng1',
    });

    expect(result).toEqual({ workflowInstanceId: 'wf1', created: false });
    expect(calls.some((c) => c.sql.includes('INTO hsdg.audit_workflow_phases'))).toBe(false);
    expect(audit.recordWith).not.toHaveBeenCalled();
  });

  it('restores a cancelled file when Statutory Audit is re-added, instead of a blank one', async () => {
    const svc = new StatutoryAuditWorkflowService(db, audit);
    const { client, calls } = scriptedClient([{ rows: [{ id: 'wf-old' }] }]);

    const result = await svc.provision(client, ctx, {
      engagementServiceId: 'es2',
      engagementId: 'eng1',
    });

    expect(result).toEqual({ workflowInstanceId: 'wf-old', created: false });
    expect(calls[0]!.sql).toContain("status = 'active'");
    expect(calls[0]!.params.slice(0, 2)).toEqual(['es2', 'eng1']);
    expect(calls.some((c) => c.sql.includes('INSERT INTO hsdg.service_workflow_instances'))).toBe(
      false,
    );
    expect((audit.recordWith as jest.Mock).mock.calls[0][2].action).toBe(
      'statutory_audit.workflow_restored',
    );
  });
});

describe('StatutoryAuditWorkflowService.cancelForService', () => {
  const audit = { recordWith: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const svc = new StatutoryAuditWorkflowService({} as DatabaseService, audit);
  beforeEach(() => jest.clearAllMocks());

  it('cancels the audit file with its service line and records it', async () => {
    const { client, calls } = scriptedClient([
      { rows: [{ id: 'wf1', status: 'active', signed_off_at: null }] },
      { rows: [], rowCount: 1 },
    ]);
    await svc.cancelForService(client, ctx, 'es1');
    expect(calls[1]!.sql).toContain("SET status = 'cancelled'");
    expect((audit.recordWith as jest.Mock).mock.calls[0][2].action).toBe(
      'statutory_audit.workflow_cancelled',
    );
  });

  it('does nothing for a service line with no audit file', async () => {
    const { client, calls } = scriptedClient([{ rows: [] }]);
    await svc.cancelForService(client, ctx, 'es-gst');
    expect(calls).toHaveLength(1);
    expect(audit.recordWith).not.toHaveBeenCalled();
  });

  it('refuses to remove the service of a signed-off file', async () => {
    const { client } = scriptedClient([
      { rows: [{ id: 'wf1', status: 'active', signed_off_at: new Date() }] },
    ]);
    await expect(svc.cancelForService(client, ctx, 'es1')).rejects.toThrow(
      /signed off or archived/,
    );
  });

  it('fails loudly when RLS lets the update touch nothing (not a lead)', async () => {
    const { client } = scriptedClient([
      { rows: [{ id: 'wf1', status: 'active', signed_off_at: null }] },
      { rows: [], rowCount: 0 },
    ]);
    await expect(svc.cancelForService(client, ctx, 'es1')).rejects.toThrow(/partner or manager/);
  });
});
