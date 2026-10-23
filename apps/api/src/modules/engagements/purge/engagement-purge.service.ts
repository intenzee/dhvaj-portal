import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ROLE } from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AuditService } from '../../audit/audit.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../../documents/storage/storage-provider';

/** What deleting an engagement would remove (GET /engagement-purge?code=). */
export interface EngagementPurgePreview {
  id: string;
  engagementCode: string;
  clientName: string;
  status: string;
  financialYear: string;
  documents: number;
  tasks: number;
  filings: number;
  timeEntries: number;
  invoices: number;
  issuedInvoices: number;
  /** Engagements merged into this one — they are deleted with it. */
  merged: number;
}

export interface EngagementPurgeResult {
  engagementCode: string;
  filesRemoved: number;
}

interface PreviewRow {
  id: string;
  engagement_code: string;
  client_name: string;
  status: string;
  financial_year: string;
  documents: number;
  tasks: number;
  filings: number;
  time_entries: number;
  invoices: number;
  issued_invoices: number;
  merged: number;
}

/**
 * Permanent deletion of an engagement opened by mistake — administrator only.
 * Everything under it goes (hsdg.purge_engagement); the bytes of its files are
 * removed once the delete has committed. One audit event records that it was
 * deleted, by whom, and what it held.
 */
@Injectable()
export class EngagementPurgeService {
  private readonly logger = new Logger(EngagementPurgeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async preview(ctx: RlsContext, code: string): Promise<EngagementPurgePreview> {
    requireAdministrator(ctx);
    const row = await this.db.withRlsContext(ctx, (client) => findByCode(client, code));
    if (!row) throw new NotFoundException(`No engagement has the code ${code.trim()}.`);
    return toPreview(row);
  }

  async purge(ctx: RlsContext, id: string, confirmCode: string): Promise<EngagementPurgeResult> {
    requireAdministrator(ctx);
    const { preview, refs } = await this.db.withRlsContext(ctx, async (client) => {
      const row = await findByCode(client, confirmCode);
      if (!row || row.id !== id) {
        throw new BadRequestException('Type the engagement’s code exactly to delete it.');
      }
      const { rows } = await client.query<{ refs: string[] | null }>(
        `SELECT hsdg.purge_engagement($1) AS refs`,
        [id],
      );
      const preview = toPreview(row);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.purged',
        objectType: 'engagement',
        objectId: id,
        before: preview,
      });
      return { preview, refs: rows[0]?.refs ?? [] };
    });
    let filesRemoved = 0;
    for (const ref of refs) {
      try {
        await this.storage.remove(ref);
        filesRemoved += 1;
      } catch (err) {
        this.logger.warn(
          `Could not remove a stored file of ${preview.engagementCode}: ${String(err)}`,
        );
      }
    }
    return { engagementCode: preview.engagementCode, filesRemoved };
  }
}

function requireAdministrator(ctx: RlsContext): void {
  if (ctx.role !== ROLE.admin && !(ctx.roles ?? []).includes(ROLE.admin)) {
    throw new ForbiddenException('Only an administrator can delete an engagement permanently.');
  }
}

async function findByCode(client: PoolClient, code: string): Promise<PreviewRow | null> {
  const { rows } = await client.query<PreviewRow>(
    `SELECT * FROM hsdg.purge_engagement_preview($1)`,
    [code],
  );
  return rows[0] ?? null;
}

function toPreview(r: PreviewRow): EngagementPurgePreview {
  return {
    id: r.id,
    engagementCode: r.engagement_code,
    clientName: r.client_name,
    status: r.status,
    financialYear: r.financial_year,
    documents: r.documents,
    tasks: r.tasks,
    filings: r.filings,
    timeEntries: r.time_entries,
    invoices: r.invoices,
    issuedInvoices: r.issued_invoices,
    merged: r.merged,
  };
}
