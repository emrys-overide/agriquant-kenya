import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agriquant | Kilimo Hub",
  description: "A clear, trusted farming dashboard for live Kenyan weather, market prices, crop insights, and practical advice.",
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
