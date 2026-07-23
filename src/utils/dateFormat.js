// Shared date/time formatter used anywhere a "Date" column needs to show
// the full timestamp, not just the date — e.g. "20 Jul 2026, 14:35:42".
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}