// Copy for /unsubscribe (shared by the server page and the client view). docs/trade-ideas.md "Unsubscribe".
import { SUPPORT_EMAIL } from '@/lib/site';

export type ViewState = 'confirm' | 'done' | 'already' | 'invalid' | 'error' | 'limited' | 'undone';

export const SCOPE_BODY = 'Sign-in and other account emails, Telegram and browser notifications are not changed.';
export const MANUAL_PATH = 'Sign in to StocksTrendz, open Trade Ideas, choose Alerts and tick Email.';
export const SUPPORT_HREF = `mailto:${SUPPORT_EMAIL}`;

export interface StateCopy { icon: 'envelope' | 'check' | 'info' | 'warn' | 'alert'; title: string; body: string[] }

export const COPY: Record<ViewState, StateCopy> = {
  confirm: {
    icon: 'envelope',
    title: 'Unsubscribe from Trade Ideas emails?',
    body: [`You will stop getting Trade Ideas alert emails from StocksTrendz. ${SCOPE_BODY}`],
  },
  done: {
    icon: 'check',
    title: 'You are unsubscribed from Trade Ideas emails',
    body: [
      'We will not send you Trade Ideas alert emails any more. This can take a moment to apply to an email that is already on its way.',
      'Your sign-in and other account emails, Telegram alerts and browser notifications are not changed.',
    ],
  },
  already: {
    icon: 'info',
    title: 'Trade Ideas emails are off',
    body: ['Trade Ideas alert emails are not being sent for this link. Nothing more to do.'],
  },
  undone: {
    icon: 'check',
    title: 'Trade Ideas emails are back on',
    body: ['You will get Trade Ideas alert emails again.'],
  },
  invalid: {
    icon: 'warn',
    title: 'This unsubscribe link does not work',
    body: ['The link may be incomplete (some mail apps break long links) or out of date. You can still stop the emails yourself:'],
  },
  error: {
    icon: 'alert',
    title: 'We could not unsubscribe you just now',
    body: ['Something went wrong on our side. Please try again.'],
  },
  limited: {
    icon: 'alert',
    title: 'Too many attempts',
    body: ['Please wait a few minutes and try again.'],
  },
};

export const MANUAL_STEPS = ['Sign in to StocksTrendz.', 'Open Trade Ideas and choose Alerts.', 'Untick Email.'];
