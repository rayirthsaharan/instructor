import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // The dev-mode indicator covers UI in e2e screenshots and is not part of the product.
  devIndicators: false,
};

export default nextConfig;
