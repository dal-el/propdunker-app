// app/layout.tsx
import '../styles/premium.css'
import "./globals.css";
import type { Metadata } from "next";
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: "PROPDUNKER — Game Page",
  description: "BetLines feed (1 row = 1 bet).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el" suppressHydrationWarning>  {/* Προσθήκη εδώ */}
      <body className="min-h-screen">
        <Sidebar />
        {children}
      </body>
    </html>
  );
}