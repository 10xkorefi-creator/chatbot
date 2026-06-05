import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Accountant Chatbot",
  description: "AI Assistant for AI Accountant by Korefi Business Solutions",
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
