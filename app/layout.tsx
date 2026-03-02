import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Examiner — AI Peer Review",
  description:
    "Multi-agent AI system that critically evaluates research papers across 11 dimensions.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
