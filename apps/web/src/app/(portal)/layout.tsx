import { AppShell } from '@/components/app-shell';

export default function PortalLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <AppShell>{children}</AppShell>;
}
