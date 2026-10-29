import type { ReactNode } from 'react';
import { GLOSSARY, type GlossaryKey } from '@/lib/payoff/glossary';

/** A symbol or acronym with its plain-English explanation on hover (lib/payoff/glossary.ts). */
export default function Term({ k, children, className = '' }: { k: GlossaryKey; children?: ReactNode; className?: string }) {
  return (
    <span title={GLOSSARY[k]} className={`cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2 ${className}`}>
      {children}
    </span>
  );
}
