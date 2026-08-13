'use client';

import { createContext, useContext } from 'react';
import type { CurrentUserContext } from '@/lib/appUsers';

const AuthContext = createContext<CurrentUserContext | null>(null);

/**
 * Server-rendered auth/plan state, made available to client components
 * (Header's nav) without an extra client-side fetch. app/layout.tsx resolves
 * this once per request via getCurrentUserContext() and passes it in as
 * `value`.
 */
export default function AuthContextProvider({ value, children }: { value: CurrentUserContext; children: React.ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): CurrentUserContext {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthContextProvider');
  return ctx;
}
