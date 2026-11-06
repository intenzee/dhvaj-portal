import { NOTIFICATION_TYPE } from '@hsdg/contracts';
import { CertificatesService } from './certificates.service';

// Signing tells the people who carry the certificate on — its preparer and
// reviewer — so they issue and bill it (posted in #partner-signoff on Switch).
// The partner who signed hears nothing.

const cert = {
  version: 3,
  status: 'in_review',
  template_id: 'tpl-15cb',
  entity_name: 'Acme Exports Pvt Ltd',
  prepared_by_employee_id: 'preparer',
  reviewed_by_employee_id: 'reviewer',
};

function setup(row = cert) {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM hsdg.employees'))
        return {
          rows: [
            { full_name: 'Partner A', membership_no: '123456', cop_valid_until: '2099-12-31' },
          ],
        };
      return { rows: [] };
    }),
  };
  const audit = { recordWith: jest.fn(async () => undefined) };
  const notifications = { emitWith: jest.fn(async () => undefined) };
  const service = new CertificatesService(
    {} as never,
    audit as never,
    {} as never,
    notifications as never,
  );
  const s = service as unknown as Record<string, unknown>;
  s.write = (_ctx: unknown, work: (c: typeof client) => Promise<unknown>) => work(client);
  s.row = async () => row;
  s.templateById = async () => ({ name: 'Form 15CB' });
  s.view = async () => ({ id: 'cert-1', status: 'signed' });
  return { service, client, notifications };
}

const input = { version: 3, udin: '26123456ABCD12EF34' };

describe('CertificatesService.sign — telling the team', () => {
  it('emits certificate_signed to the preparer and reviewer with the UDIN', async () => {
    const { service, notifications } = setup();
    await service.sign(
      { employeeId: 'partner', role: 'partner' } as never,
      'eng-1',
      'cert-1',
      input as never,
    );
    expect(notifications.emitWith).toHaveBeenCalledTimes(1);
    const event = (notifications.emitWith.mock.calls[0] as unknown[])[2];
    expect(event).toMatchObject({
      type: NOTIFICATION_TYPE.certificateSigned,
      recipientEmployeeIds: ['preparer', 'reviewer'],
      title: 'Signed: Form 15CB · Acme Exports Pvt Ltd',
      engagementId: 'eng-1',
      objectType: 'certificate',
      objectId: 'cert-1',
    });
    expect((event as { body: string }).body).toContain('UDIN 26123456ABCD12EF34');
    expect((event as { body: string }).body).toContain('signed by Partner A');
  });

  it('never tells the partner who signed, even when they also prepared it', async () => {
    const { service, notifications } = setup({ ...cert, prepared_by_employee_id: 'partner' });
    await service.sign(
      { employeeId: 'partner', role: 'partner' } as never,
      'eng-1',
      'cert-1',
      input as never,
    );
    const event = (notifications.emitWith.mock.calls[0] as unknown[])[2];
    expect(event).toMatchObject({ recipientEmployeeIds: ['reviewer'] });
  });

  it('a manager cannot sign, and nothing is emitted', async () => {
    const { service, notifications } = setup();
    await expect(
      service.sign(
        { employeeId: 'mgr', role: 'manager' } as never,
        'eng-1',
        'cert-1',
        input as never,
      ),
    ).rejects.toThrow('Only a partner signs a certificate.');
    expect(notifications.emitWith).not.toHaveBeenCalled();
  });
});
