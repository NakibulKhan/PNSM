import { PageHeader } from '@/components/common/page-header';
import { FlaggedQueue } from '@/components/dashboard/flagged-queue';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';

export default function FlaggedPage() {
  return (
    <>
      <PageHeader
        title="Flagged check-ins"
        description={`Check-ins that scored below ${FACE_MATCH_THRESHOLD}% and need a human decision.`}
      />
      <FlaggedQueue />
    </>
  );
}
