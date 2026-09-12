import { PageHeader } from '@/components/common/page-header';
import { LivePresenceView } from '@/components/dashboard/live-presence';

export default function LiveMapPage() {
  return (
    <>
      <PageHeader
        title="Live map"
        description="Where the checked-in workforce is right now, against each office geofence."
      />
      <LivePresenceView />
    </>
  );
}
