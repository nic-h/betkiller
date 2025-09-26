import type { Metadata } from "next";
import { Fira_Code } from "next/font/google";
import "./globals.css";

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap"
});

export const metadata: Metadata = {
  title: "Context Edge",
  description: "On-chain dashboard for Context Markets"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${firaCode.className} bg-surface text-ink`}>
      <body className="bg-surface text-ink">
        {children}
      </body>
    </html>
  );
}
