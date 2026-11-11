import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Bricolage_Grotesque } from 'next/font/google';
import { RouteFocus } from '@/components/features/route-focus';
import { ToastProvider } from '@/components/ui';
import './globals.css';

// DS section 3: three free Google families, self-hosted by next/font, Latin subset, display: swap.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  variable: '--font-bricolage',
});
const text = Atkinson_Hyperlegible_Next({
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  variable: '--font-atkinson',
});
const label = Atkinson_Hyperlegible_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '600'],
  variable: '--font-atkinson-mono',
});

export const metadata: Metadata = {
  title: 'Instructor',
  description: 'Turn product manuals into simple, source-anchored step-by-step guides.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F3EC' },
    { media: '(prefers-color-scheme: dark)', color: '#141310' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: a manual theme switch sets data-theme on <html> on the client.
    <html lang="en" className={`${display.variable} ${text.variable} ${label.variable}`} suppressHydrationWarning>
      <body>
        <ToastProvider>
          <RouteFocus />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
