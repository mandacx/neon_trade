import type { Metadata } from 'next';
import LegalPage from '@/components/layout/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Use - StocksTrendz',
  description: 'Terms of use for StocksTrendz, including the investment disclaimer.',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="November 6, 2026">
      <p>By using StocksTrendz you agree to these terms.</p>
      <h2>Informational use only</h2>
      <p>
        Everything on this site, including price levels, scan alerts, scanners, earnings data and performance
        statistics, is provided for educational and informational purposes. It is not investment advice, a
        recommendation or a solicitation to buy or sell any security. StocksTrendz is not a registered investment
        adviser or broker-dealer and does not execute trades.
      </p>
      <h2>Risk</h2>
      <p>
        Trading securities and options carries a high risk of loss and may not suit all investors. Past performance
        does not indicate future results. You alone are responsible for your decisions; consult a licensed financial
        professional.
      </p>
      <h2>Data accuracy</h2>
      <p>Data may be delayed, incomplete or contain errors. It is provided &quot;as is&quot; without warranty.</p>
      <h2>Accounts and plans</h2>
      <p>You are responsible for your account. Paid features depend on your plan. We may change or discontinue features, and may suspend accounts that abuse the service or its rate limits.</p>
      <h2>Acceptable use</h2>
      <p>Do not scrape, resell or redistribute the data, or attempt to disrupt or gain unauthorized access to the service.</p>
      <h2>Liability</h2>
      <p>To the extent permitted by law, StocksTrendz is not liable for losses arising from use of the site or reliance on its content.</p>
      <h2>Contact</h2>
      <p><a href="mailto:support@stockstrendz.com">support@stockstrendz.com</a></p>
    </LegalPage>
  );
}
