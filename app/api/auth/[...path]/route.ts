import { auth } from '@/lib/auth/server';

// Handles all Neon Auth API calls: sign in/up, email OTP verification,
// session management, password reset. See lib/auth/server.ts.
export const { GET, POST } = auth.handler();
