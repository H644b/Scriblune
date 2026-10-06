import { themeBootstrap } from "@/lib/theme-bootstrap";
import type { Metadata, Viewport } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/400-italic.css";
import "katex/dist/katex.min.css";
import "./globals.css";
import { brand } from "@/lib/brand";
import { Providers } from "@/components/providers";
export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.description,
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: brand.name,
    description: brand.description,
    type: "website",
  },
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3eb" },
    { media: "(prefers-color-scheme: dark)", color: "#191d24" },
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
