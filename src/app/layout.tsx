import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outfit Builder — wear it your way",
  description: "Mix your own clothes, find your colors, and put your next outfit together.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
