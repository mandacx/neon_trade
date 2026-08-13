import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import AuthContextProvider from "@/components/providers/AuthContextProvider";
import { getCurrentUserContext } from "@/lib/appUsers";

export const metadata: Metadata = {
  title: "Neon Trade - Stock Analysis Platform",
  description: "Advanced stock analysis with K-line charts and quadrant visualization",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// getCurrentUserContext() reads cookies (via Neon Auth's getSession()), so
// the whole app renders dynamically.
export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const authCtx = await getCurrentUserContext();
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthContextProvider value={authCtx}>
          {children}
          <Analytics />
        </AuthContextProvider>
      </body>
    </html>
  );
}
