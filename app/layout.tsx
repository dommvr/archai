import type { Metadata } from 'next'
import { Inter, Cormorant_Garamond } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'ArchAI — AI-Native Architecture Platform',
    template: '%s | ArchAI',
  },
  description:
    'Accelerate your architectural workflow with AI-powered zoning analysis, massing generation, sustainability analysis, and BIM-aware design assistance.',
  keywords: [
    'architecture AI',
    'BIM',
    'massing generator',
    'zoning checker',
    'sustainability copilot',
    'space planning',
    'AEC software',
  ],
  authors: [{ name: 'ArchAI' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'ArchAI',
    title: 'ArchAI — AI-Native Architecture Platform',
    description:
      'Accelerate your architectural workflow 5–10x with AI-powered design tools.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ArchAI — AI-Native Architecture Platform',
    description: 'AI-powered design tools for architects.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${cormorant.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans bg-archai-black text-white min-h-screen">
        {children}
      </body>
    </html>
  )
}
