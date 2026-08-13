import { createNeonAuth } from '@neondatabase/auth/next/server';

// Managed Better Auth (Neon Auth). Enable/rotate the base URL from the Neon
// console: Project -> Branch -> Auth -> Configuration.
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});
