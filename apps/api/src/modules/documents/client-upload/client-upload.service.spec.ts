import { NOTIFICATION_TYPE, SYSTEM_ROLE } from '@hsdg/contracts';
import { ClientUploadService } from './client-upload.service';

const link = {
  valid: true,
  engagement_id: 'eng-1',
  requested_info: 'Sales register for October 2026',
  outstanding_items: null,
  entity_name: 'Sharma Traders',
  engagement_code: 'CR/00016',
  expires_at: new Date('2026-11-08T20:00:00Z'),
  uploads_remaining: 20,
};

function setup(recipients: { engagement_id: string; employee_id: string }[], emit = jest.fn()) {
  const tx = {
    query: jest.fn(async (sql: string) =>
      sql.includes('client_upload_recipients') ? { rows: recipients } : { rows: [] },
    ),
  };
  const db = {
    query: jest.fn(async (sql: string) =>
      sql.includes('client_upload_link_info') ? { rows: [link] } : { rows: [{ id: 'doc-1' }] },
    ),
    withRlsContext: jest.fn(async (_ctx: unknown, fn: (c: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const config = { get: (k: string) => (k === 'CLIENT_UPLOAD_ENABLED' ? true : 10_000_000) };
  const storage = {
    newReference: () => 'ref-1',
    write: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  };
  const notifications = { emitWith: emit };
  const service = new ClientUploadService(
    db as never,
    config as never,
    {} as never,
    storage as never,
    notifications as never,
  );
  return { service, db, emit };
}

const upload = { filename: 'sales.csv', contentType: 'text/csv', contentBase64: 'YSxiCjEsMgo=' };

describe('ClientUploadService.publicUpload — telling the team', () => {
  it('notifies whoever asked for the document, as "document uploaded"', async () => {
    const { service, db, emit } = setup([
      { engagement_id: 'eng-1', employee_id: 'chaser' },
      { engagement_id: 'eng-1', employee_id: 'manager' },
    ]);
    await expect(service.publicUpload('tok', upload)).resolves.toEqual({ ok: true });
    expect(db.withRlsContext).toHaveBeenCalledWith(
      expect.objectContaining({ role: SYSTEM_ROLE }),
      expect.any(Function),
    );
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][2]).toMatchObject({
      type: NOTIFICATION_TYPE.documentUploaded,
      recipientEmployeeIds: ['chaser', 'manager'],
      title: 'Sharma Traders uploaded: Sales register for October 2026',
      engagementId: 'eng-1',
      objectType: 'document',
      objectId: 'doc-1',
    });
  });

  it('emits nothing when nobody is found to tell', async () => {
    const { service, emit } = setup([]);
    await service.publicUpload('tok', upload);
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps the upload when the notification fails', async () => {
    const { service } = setup(
      [{ engagement_id: 'eng-1', employee_id: 'chaser' }],
      jest.fn(async () => {
        throw new Error('outbox down');
      }),
    );
    await expect(service.publicUpload('tok', upload)).resolves.toEqual({ ok: true });
  });
});
