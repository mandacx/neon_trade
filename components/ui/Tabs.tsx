'use client';

import type { ReactNode } from 'react';

/** Box colour of a tab: a light fill, and a darker fill of the same hue when selected. */
export type TabTone = 'gray' | 'green' | 'orange' | 'blue' | 'amber' | 'violet';

// Literal class strings so Tailwind keeps them.
const TONES: Record<TabTone, { idle: string; active: string }> = {
  gray: { idle: 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200', active: 'bg-gray-700 text-white border-gray-700' },
  green: { idle: 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100', active: 'bg-green-600 text-white border-green-600' },
  orange: { idle: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100', active: 'bg-orange-600 text-white border-orange-600' },
  blue: { idle: 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100', active: 'bg-blue-600 text-white border-blue-600' },
  amber: { idle: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100', active: 'bg-amber-600 text-white border-amber-600' },
  violet: { idle: 'bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100', active: 'bg-violet-600 text-white border-violet-600' },
};

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  /** Hover text. */
  title?: string;
  /** Small badge after the label (e.g. "Pro"). */
  badge?: string;
  /** Box colour; gray when omitted. */
  tone?: TabTone;
}

/**
 * Tab bar of solid boxes, each in its own light colour; the selected one is a darker fill of
 * the same colour. Scrolls sideways on narrow screens instead of wrapping.
 * Panels are the caller's: render the active one (or keep visited ones mounted and hide the rest).
 */
export default function Tabs<T extends string>({ tabs, value, onChange, className = '' }: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex gap-2 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {tabs.map(t => {
        const active = t.id === value;
        const tone = TONES[t.tone ?? 'gray'];
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            title={t.title}
            onClick={() => onChange(t.id)}
            className={`shrink-0 px-4 py-2 rounded-lg border text-sm font-semibold transition-colors whitespace-nowrap ${active ? `${tone.active} shadow-sm` : tone.idle}`}
          >
            {t.label}
            {t.badge && <span className="ml-1.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
