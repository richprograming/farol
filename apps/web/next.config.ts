import type { NextConfig } from 'next';

const config: NextConfig = {
  // O núcleo é TypeScript puro, sem build: o Next transpila direto.
  transpilePackages: ['@farol/core'],
};

export default config;
