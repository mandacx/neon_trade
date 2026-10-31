'use client';

import { useParams } from 'next/navigation';
import CryptoAnalysis from '@/components/crypto/CryptoAnalysis';

export default function CryptoInstrumentPage() {
  const params = useParams();
  const slug = String(params?.slug ?? '').toLowerCase();
  return <CryptoAnalysis key={slug} slug={slug} />;
}
