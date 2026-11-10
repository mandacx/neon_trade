// Public site constants (safe for client and server). The sender address used
// by lib/email.ts comes from EMAIL_FROM; this is the address shown to visitors.
export const SITE_NAME = 'StocksTrendz';
export const SITE_URL = 'https://stockstrendz.com';
export const SUPPORT_EMAIL = 'support@stockstrendz.com';
// Display name of the Trade Ideas alert sender (lib/email.ts builds "name <address>" from EMAIL_FROM's address part).
export const IDEA_SENDER_NAME = `${SITE_NAME} Trade Ideas`;
