import { PageHeader } from '@/components/common/page-header';
import { GeofenceManager } from '@/components/dashboard/geofence-manager';

export default function GeofencesPage() {
  return (
    <>
      <PageHeader
        title="Geofences"
        description="Set where each office is and how far from it a check-in is accepted."
      />
      <GeofenceManager />
    </>
  );
}
