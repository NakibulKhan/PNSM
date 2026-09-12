import { PageHeader } from '@/components/common/page-header';
import { SettingsView } from '@/components/dashboard/settings-view';

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your account, your permissions, and the rules in force." />
      <SettingsView />
    </>
  );
}
