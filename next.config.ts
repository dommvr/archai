import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Critical: Three.js and R3F ship as ESM-only modules.
  // Without transpilePackages, Next.js webpack cannot parse their import syntax.
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei'],

  turbopack: {
    resolveAlias: {
      // @speckle/shared uses the package.json "imports" field to alias
      // '#lodash' to 'lodash-es' (ESM) or 'lodash' (CJS). Turbopack does
      // not resolve package-internal subpath imports automatically, so we
      // provide the alias explicitly. lodash-es is installed as a transitive
      // dependency of @speckle/viewer and is safe to use here.
      '#lodash': 'lodash-es',
    },
  },

  images: {
    remotePatterns: [
      // Add Supabase storage domain here when configuring:
      // { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
}

export default nextConfig
