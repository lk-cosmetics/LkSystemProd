import { Loader2 } from 'lucide-react';

/**
 * Full-bleed loading fallback for lazily-loaded route chunks.
 * Announced to assistive tech via role="status" + an sr-only label.
 */
export default function PageLoader() {
  return (
    <div
      className="flex min-h-[50vh] w-full items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
