'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Wraps a live value and flashes it green (went up) or red (went down) for about a
 * second when `value` changes. The first render never flashes, and a value that goes
 * from or to null/undefined (loading, no quote) never flashes either. Styles are the
 * `.quote-flash-*` classes in app/globals.css (disabled under prefers-reduced-motion).
 *
 * `inline-block` + `rounded` so the highlight hugs the number; pass `className` to align it.
 */
export default function QuoteFlash({ value, children, className = '' }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before == null || value == null || before === value) return;
    setFlash(f => ({ dir: value > before ? 'up' : 'down', n: (f?.n ?? 0) + 1 }));
  }, [value]);

  // Keyed by the change counter so two quick changes restart the animation.
  return (
    <span
      key={flash?.n ?? 0}
      className={`inline-block rounded ${flash ? (flash.dir === 'up' ? 'quote-flash-up' : 'quote-flash-down') : ''} ${className}`}
    >
      {children}
    </span>
  );
}
