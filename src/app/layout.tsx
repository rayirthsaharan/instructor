import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Instructor',
  description: 'Turn product manuals into simple, source-anchored step-by-step guides.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
