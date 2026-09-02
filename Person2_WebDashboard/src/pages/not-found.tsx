import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/states';

/**
 * Client-side 404.
 *
 * Reaching this from a cold deep link depends on CloudFront returning
 * /index.html with a 200 for unknown paths; otherwise the edge answers with its
 * own XML error and this component never mounts. See docs/02-BUG-BIBLE.md §1.
 */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md">
        <EmptyState
          icon={FileQuestion}
          title="That page does not exist"
          message="The link may be out of date, or the record may have been removed."
          action={
            <Link to="/dashboard">
              <Button>Back to dashboard</Button>
            </Link>
          }
        />
      </div>
    </div>
  );
}
