import Header from '@/components/layout/Header';
import SiteFooter from '@/components/layout/SiteFooter';

export default function LegalPage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <main className="max-w-3xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {updated && <p className="text-xs text-gray-400 mt-1">Last updated: {updated}</p>}
          <div className="mt-5 space-y-4 text-sm text-gray-700 leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:pt-2 [&_a]:text-blue-600 [&_a:hover]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
            {children}
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
