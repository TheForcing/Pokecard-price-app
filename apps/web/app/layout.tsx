import { Fraunces, Space_Grotesk } from 'next/font/google';
import './globals.css';

const headingFont = Fraunces({
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

const bodyFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata = {
  title: 'PokéCard Price Finder',
  description: 'Upload a Pokémon card photo -> recognize -> show low/high price',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>{children}</body>
    </html>
  );
}
