import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import AuthContextProvider from "@/components/providers/AuthContextProvider";
import ActivityTracker from "@/components/providers/ActivityTracker";
import { getCurrentUserContext } from "@/lib/appUsers";

export const metadata: Metadata = {
  metadataBase: new URL("https://stockstrendz.com"),
  title: "StocksTrendz - Stock Analysis Platform",
  description: "US stock and options analysis: option open-interest price levels, candlestick charts, scanners, earnings and watchlists.",
  openGraph: {
    type: "website",
    siteName: "StocksTrendz",
    title: "StocksTrendz - Stock Analysis Platform",
    description: "US stock and options analysis: option open-interest price levels, candlestick charts, scanners, earnings and watchlists.",
    url: "https://stockstrendz.com",
  },
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
          <ActivityTracker />
          <Analytics />
        </AuthContextProvider>
      </body>
    </html>
  );
}
