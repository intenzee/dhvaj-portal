'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FEATURE_FLAG } from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { fetchNotice, noticeKey } from '@/lib/notices-api';
import { EmptyState, PageHeader, Spinner } from '@/components/ui';
import { NoticeWorkspace } from '@/components/notices/notice-workspace';

export default function NoticePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.notices);
  const q = useQuery({
    queryKey: noticeKey(id),
    queryFn: () => fetchNotice(id),
    enabled: on,
    retry: (n, err) =>
      !(err instanceof ApiError && (err.status === 404 || err.status === 403)) && n < 2,
  });

  if (!flags.isLoading && !on) {
    return (
      <div>
        <PageHeader title="Notice" back={{ href: '/', label: 'Home' }} />
        <EmptyState>The notice register isn&rsquo;t switched on for your office yet.</EmptyState>
      </div>
    );
  }
  if (q.isError) {
    const missing =
      q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return (
      <div>
        <PageHeader title="Notice" back={{ href: '/notices', label: 'Notices' }} />
        <EmptyState>
          {missing
            ? 'This notice does not exist, or it is on an engagement you are not on.'
            : 'Could not load the notice. Check that the API is reachable.'}{' '}
          <Link href="/notices" className="font-medium text-primary-700 hover:underline">
            Back to notices
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (!q.data) return <Spinner />;
  return <NoticeWorkspace notice={q.data} />;
}
