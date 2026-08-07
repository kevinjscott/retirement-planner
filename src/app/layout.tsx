import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { OrbsBackdrop } from "@/components/OrbsBackdrop";
import "./globals.css";
import "./calculator.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Retirement scenarios",
  description: "One-screen retire-now planner for balances, major expenses, working years, and withdrawals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="stylesheet" href="/assets/vercel-brand.css" />
      </head>
      <body className="vbg-report min-h-full">
        <OrbsBackdrop />
        {children}
      </body>
    </html>
  );
}
