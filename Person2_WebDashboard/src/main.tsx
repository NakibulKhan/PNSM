import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router/routes';
import './index.css';

/**
 * Application entry.
 *
 * StrictMode stays on deliberately. It double-invokes effects in development to
 * surface missing cleanup — which is exactly how the duplicated-socket bug is
 * caught before it reaches a demo. Turning it off would hide the defect, not
 * fix it. See `src/lib/socket.ts`.
 */
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
