import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { OperatorStatus } from "@/components/operator-status";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Glass Ledger",
  description:
    "The public ledger, the buyer's check, and the creator's tags — all read from the chain, none of them from the shop.",
};

const surfaces = [
  { href: "/ledger", name: "The ledger" },
  { href: "/buy", name: "Buy" },
  { href: "/creator", name: "The tags" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: "dark" }}
    >
      <body className="flex min-h-full flex-col bg-neutral-950 text-neutral-100">
        <header className="sticky top-0 z-10 border-b border-neutral-900 bg-neutral-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Glass Ledger
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-400">
              {surfaces.map((surface) => (
                <Link key={surface.href} href={surface.href} className="hover:text-neutral-100">
                  {surface.name}
                </Link>
              ))}
            </nav>
            <div className="ml-auto">
              <OperatorStatus />
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
