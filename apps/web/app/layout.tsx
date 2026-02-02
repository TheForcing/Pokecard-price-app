export const metadata = {
  title: 'PokéCard Price Finder',
  description: 'Upload a Pokémon card photo -> recognize -> show low/high price',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>{children}</body>
    </html>
  );
}
