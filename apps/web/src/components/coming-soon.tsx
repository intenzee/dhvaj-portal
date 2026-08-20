import { PageHeader, Card, CardBody } from './ui';

/** Honest placeholder for nav destinations whose screens land in a later phase. */
export function ComingSoon({ title, phase }: { title: string; phase: string }): JSX.Element {
  return (
    <div>
      <PageHeader title={title} />
      <Card>
        <CardBody className="py-10 text-center text-sm text-ink-muted">
          <div className="mb-1 text-base font-medium text-ink">Coming soon</div>
          This area is planned for {phase}. The backend module and APIs it will build on are
          already in place.
        </CardBody>
      </Card>
    </div>
  );
}
