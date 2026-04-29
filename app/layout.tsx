import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neon Trade - Stock Analysis Platform",
  description: "Advanced stock analysis with K-line charts and quadrant visualization",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
