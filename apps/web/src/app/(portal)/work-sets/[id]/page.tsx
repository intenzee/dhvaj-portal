'use client';

import { useParams } from 'next/navigation';
import { WorkSetDetailScreen } from '@/components/work-sets/work-set-detail';

export default function WorkSetPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <WorkSetDetailScreen id={id} />;
}
