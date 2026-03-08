import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Critical: Three.js and R3F ship as ESM-only modules.
  // Without transpilePackages, Next.js webpack cannot parse their import syntax.
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei'],

  images: {
    remotePatterns: [
      // Add Supabase storage domain here when configuring:
      // { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
}

export default nextConfig
