'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import { authClient } from '@/lib/auth/client';

type Mode = 'login' | 'register' | 'otp';

const inputClass = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";
const labelClass = "block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  async function afterSessionEstablished() {
    // Single-session enforcement: the just-created session is the only one
    // that stays valid going forward.
    await authClient.revokeOtherSessions();
    router.push('/');
    router.refresh();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email: loginEmail, password: loginPassword });
    setBusy(false);
    if (err) { setError(err.message ?? 'Could not sign in.'); return; }
    await afterSessionEstablished();
  }

  // Full-page redirect to Google, then back through /auth/social-callback —
  // that's where revokeOtherSessions() actually runs (see that page), since
  // this call navigates away rather than resolving in place like the
  // email/password flow above.
  async function handleGoogleSignIn() {
    setError(null);
    const { error: err } = await authClient.signIn.social({ provider: 'google', callbackURL: '/auth/social-callback' });
    if (err) setError(err.message ?? 'Could not start Google sign-in.');
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.signUp.email({ email, name, password });
    if (err) { setBusy(false); setError(err.message ?? 'Could not create account.'); return; }
    if (data?.token) { setBusy(false); await afterSessionEstablished(); return; }
    // No token yet: email verification is required before a session exists.
    const { error: otpErr } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
    setBusy(false);
    if (otpErr) { setError(otpErr.message ?? 'Could not send verification code.'); return; }
    setMode('otp');
    setTimeout(() => otpRefs.current[0]?.focus(), 50);
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = otp.join('');
    const { data, error: err } = await authClient.emailOtp.verifyEmail({ email, otp: code });
    setBusy(false);
    if (err) { setError(err.message ?? 'Invalid or expired code.'); return; }
    if (!data?.token) { setError('Verified, but no session was returned — please log in.'); setMode('login'); return; }
    await afterSessionEstablished();
  }

  async function resendOtp() {
    setError(null);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
    if (err) setError(err.message ?? 'Could not resend code.');
  }

  function handleOtpChange(i: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    if (digit && i < 5) otpRefs.current[i + 1]?.focus();
  }
  function handleOtpKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-10">
          <div className="max-w-sm mx-auto">
            <h1 className="text-xl font-bold text-gray-900 text-center mb-1">
              {mode === 'otp' ? 'Verify your email' : 'Sign in to Neon Trade'}
            </h1>
            <p className="text-xs text-gray-400 text-center mb-6">
              {mode === 'otp' ? `We sent a 6-digit code to ${email}` : 'Email + password, with a one-time code to verify your address.'}
            </p>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              {mode !== 'otp' && (
                <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-5">
                  <button
                    onClick={() => { setMode('login'); setError(null); }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'login' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                  >
                    Log in
                  </button>
                  <button
                    onClick={() => { setMode('register'); setError(null); }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'register' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                  >
                    Sign up
                  </button>
                </div>
              )}

              {error && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700">{error}</div>
              )}

              {mode === 'login' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className={labelClass}>Email</label>
                    <input className={inputClass} type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <div>
                    <label className={labelClass}>Password</label>
                    <input className={inputClass} type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} />
                  </div>
                  <button disabled={busy} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
                    {busy ? 'Signing in…' : 'Log in'}
                  </button>
                </form>
              )}

              {mode === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className={labelClass}>Name</label>
                    <input className={inputClass} type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
                  </div>
                  <div>
                    <label className={labelClass}>Email</label>
                    <input className={inputClass} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <div>
                    <label className={labelClass}>Password</label>
                    <input className={inputClass} type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
                  </div>
                  <button disabled={busy} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
                    {busy ? 'Creating account…' : 'Create account'}
                  </button>
                </form>
              )}

              {mode !== 'otp' && (
                <>
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">or</span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
                      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.4 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.5 34.6 26.9 35.5 24 35.5c-5.2 0-9.6-3.3-11.2-7.9l-6.6 5.1C9.6 39.6 16.2 44 24 44z"/>
                      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C41.5 36.3 44 30.6 44 24c0-1.3-.1-2.7-.4-3.5z"/>
                    </svg>
                    Continue with Google
                  </button>
                </>
              )}

              {mode === 'otp' && (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="flex justify-center gap-2">
                    {otp.map((d, i) => (
                      <input
                        key={i}
                        ref={el => { otpRefs.current[i] = el; }}
                        className="w-10 h-12 text-center text-lg font-bold border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                        inputMode="numeric"
                        maxLength={1}
                        value={d}
                        onChange={e => handleOtpChange(i, e.target.value)}
                        onKeyDown={e => handleOtpKeyDown(i, e)}
                      />
                    ))}
                  </div>
                  <button disabled={busy || otp.some(d => !d)} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
                    {busy ? 'Verifying…' : 'Verify & continue'}
                  </button>
                  <p className="text-center text-xs text-gray-400">
                    Didn't get it? <button type="button" onClick={resendOtp} className="text-blue-600 font-semibold">Resend code</button>
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
