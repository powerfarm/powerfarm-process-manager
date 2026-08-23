import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { AuthDisplayPreHydrationHead } from "@/components/auth/auth-display";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const title = "Marketing Room";
const description =
  "One durable workspace for strategy, content, social, search, and email.";
function resolveMetadataBase() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL;

  if (!configuredUrl) {
    return new URL("http://localhost:3000");
  }

  return new URL(
    configuredUrl.startsWith("http")
      ? configuredUrl
      : `https://${configuredUrl}`
  );
}

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  applicationName: title,
  description,
  icons: {
    apple: [{ sizes: "180x180", type: "image/png", url: "/apple-icon" }],
    icon: [{ type: "image/svg+xml", url: "/icon.svg" }],
    shortcut: ["/icon.svg"],
  },
  metadataBase: resolveMetadataBase(),
  openGraph: {
    description,
    siteName: title,
    title,
    type: "website",
  },
  title,
  twitter: {
    card: "summary_large_image",
    description,
    title,
  },
};

const themeScript = `
(() => {
  try {
    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  } catch {
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  }
})();
`;

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
          id="theme-init"
        />
        <AuthDisplayPreHydrationHead />
      </head>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
