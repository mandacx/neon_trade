'use client';

import { useParams } from 'next/navigation';
import StockAnalysis from '@/components/stock/StockAnalysis';

export default function StockPage() {
  const params = useParams();
  return <StockAnalysis symbol={params?.symbol as string} />;
}
