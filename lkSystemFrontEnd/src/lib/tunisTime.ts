/**
 * Tunisia-time helpers.
 *
 * The whole app stores instants as UTC (Django `USE_TZ=True`). The business,
 * however, thinks in **Tunisia local time** (`Africa/Tunis`, UTC+1, no DST).
 *
 * `<input type="datetime-local">` is a *wall-clock* widget with no timezone — a
 * value like `"2026-06-13T08:00"`. The naive `new Date(value)` parses that in
 * the *browser's* timezone, so a promotion window only landed on the right
 * instant when the machine happened to be set to Tunisia time. On any other
 * timezone the start/end window was shifted by the offset and "did not work".
 *
 * These helpers convert between a Tunisia wall-clock string and a UTC ISO
 * instant **explicitly**, so the result is correct regardless of where the
 * browser (or server) clock is set.
 */

export const TUNIS_TZ = 'Africa/Tunis';

/**
 * Minutes that `Africa/Tunis` is ahead of UTC at the given instant.
 *
 * Computed from the zone database via `Intl` (not a hard-coded +60), so it
 * stays correct even if Tunisia ever reintroduces DST. Tunisia has no DST
 * today, so a single pass is exact for the wall-clock → instant direction.
 */
export function tunisOffsetMinutes(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TUNIS_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asTunisUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asTunisUtc - utcMs) / 60_000);
}

/**
 * Convert a Tunisia wall-clock `<input type="datetime-local">` value
 * (`"YYYY-MM-DDTHH:MM"`) into a UTC ISO instant for the API.
 */
export function tunisLocalToIso(local: string): string {
  if (!local) return '';
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    // Unexpected shape — fall back to native parsing rather than throwing.
    const fallback = new Date(local);
    return Number.isNaN(fallback.getTime()) ? '' : fallback.toISOString();
  }
  const [, y, mo, d, h, mi, s] = m;
  // Treat the wall clock as if it were UTC, then back off the Tunis offset at
  // that instant. No DST in Tunisia → one pass is exact.
  const guessUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  const offsetMin = tunisOffsetMinutes(guessUtc);
  return new Date(guessUtc - offsetMin * 60_000).toISOString();
}

/**
 * Convert a UTC ISO instant from the API back into a Tunisia wall-clock
 * `<input type="datetime-local">` value (`"YYYY-MM-DDTHH:MM"`).
 */
export function isoToTunisLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const utcMs = new Date(iso).getTime();
  if (Number.isNaN(utcMs)) return '';
  const offsetMin = tunisOffsetMinutes(utcMs);
  return new Date(utcMs + offsetMin * 60_000).toISOString().slice(0, 16);
}

/** "Now", as a Tunisia wall-clock `datetime-local` value rounded to the minute. */
export function nowTunisLocal(): string {
  const utcMs = Date.now();
  const offsetMin = tunisOffsetMinutes(utcMs);
  const shifted = new Date(utcMs + offsetMin * 60_000);
  shifted.setUTCSeconds(0, 0);
  return shifted.toISOString().slice(0, 16);
}

/** Format a UTC ISO instant as a Tunisia-local date (e.g. "13 Jun 2026"). */
export function formatTunisDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { timeZone: TUNIS_TZ, ...opts });
}

/** Format a UTC ISO instant as a Tunisia-local date + time. */
export function formatTunisDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    timeZone: TUNIS_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
