import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cn } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Notepad", template: "%s · Notepad" },
  description: "An invite-only notepad whose notes are Markdown files in your own GitHub repositories.",
  applicationName: "Notepad",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Paint under the notch and home indicator; chrome pads itself with the safe-area utilities.
  viewportFit: "cover",
  // The software keyboard shrinks the layout viewport (and `100dvh`) on Android as on iOS.
  interactiveWidget: "resizes-content",
  // Matches `--background` in globals.css, the color at the top of every screen.
  themeColor: "#191817",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("dark", GeistSans.variable, GeistMono.variable)}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
