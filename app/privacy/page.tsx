import type { Metadata } from 'next';
import LegalPage from '@/components/layout/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy - StocksTrendz',
  description: 'What personal information StocksTrendz collects, how it is used, and your choices.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="November 6, 2026">
      <p>This policy describes what StocksTrendz collects when you use the site and how it is used.</p>
      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your email address, name and sign-in method (email and password, or Google sign-in). Passwords are handled by our authentication provider.</li>
        <li><strong>Your settings:</strong> watchlists, alert preferences, chart and table preferences, and positions you choose to track. These are private to your account.</li>
        <li><strong>Usage data:</strong> pages viewed and basic activity events, used to run and improve the service, plus aggregate analytics from Vercel Analytics.</li>
        <li><strong>Telegram:</strong> if you connect Telegram alerts, the chat identifier needed to deliver them.</li>
      </ul>
      <h2>How we use it</h2>
      <p>To provide the service and your plan&apos;s features, send the alerts you request, prevent abuse (rate limits), and understand how the product is used. We do not sell personal information.</p>
      <h2>Service providers</h2>
      <p>We use hosting, database, authentication and analytics providers (such as Vercel and Neon) to operate the site. They process data only on our behalf.</p>
      <h2>Retention and your choices</h2>
      <p>You can change your settings in your profile. To ask for access to or deletion of your account data, email <a href="mailto:support@stockstrendz.com">support@stockstrendz.com</a>.</p>
      <h2>Cookies</h2>
      <p>We use cookies needed to keep you signed in. Analytics are aggregate.</p>
      <h2>Changes</h2>
      <p>We will update the date above when this policy changes.</p>
    </LegalPage>
  );
}
