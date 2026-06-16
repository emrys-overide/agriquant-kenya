import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgriQuant Kenya - Smart Farming Dashboard",
  description: "Live weather, market prices, and AI-powered farming advice for Kenyan farmers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif" }}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
