import { LATE_ARRIVAL_CUTOFF } from './tz';

export { FACE_MATCH_THRESHOLD } from './constants';

/** "9:15 AM" — the late-arrival cutoff, formatted for display. */
export const LATE_ARRIVAL_CUTOFF_LABEL = (() => {
  const [hours, minutes] = LATE_ARRIVAL_CUTOFF.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(minutes).padStart(2, '0')} ${suffix}`;
})();
