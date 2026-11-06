import type { Metadata } from 'next';
import LegalPage from '@/components/layout/LegalPage';

export const metadata: Metadata = {
  title: 'Contact - StocksTrendz',
  description: 'How to contact StocksTrendz for support, plan questions and privacy requests.',
};

export default function ContactPage() {
  return (
    <LegalPage title="Contact">
      <p>
        For support, plan and billing questions, bug reports or privacy requests, email{' '}
        <a href="mailto:support@stockstrendz.com">support@stockstrendz.com</a>.
      </p>
      <p>To report a security issue, see <a href="/.well-known/security.txt">security.txt</a>.</p>
    </LegalPage>
  );
}
