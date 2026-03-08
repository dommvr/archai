import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

interface FooterCTAProps {
  onGetStarted: () => void
}

const FOOTER_LINKS = {
  Product: ['Features', 'Pricing', 'Changelog', 'Roadmap'],
  Resources: ['Documentation', 'Blog', 'API Reference', 'Status'],
  Company: ['About', 'Careers', 'Contact', 'Press'],
  Legal: ['Privacy Policy', 'Terms of Service', 'Cookie Policy'],
}

export function FooterCTA({ onGetStarted }: FooterCTAProps) {
  return (
    <>
      {/* Final CTA Section */}
      <section className="py-24 px-6 bg-archai-charcoal border-t border-archai-graphite relative overflow-hidden">
        {/* Background blueprint grid overlay */}
        <div className="absolute inset-0 bg-blueprint-grid opacity-30 pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <p className="text-xs font-medium tracking-widest uppercase text-archai-orange mb-6">
            Ready to build?
          </p>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl font-light text-white mb-6 leading-tight">
            Start building now.
          </h2>
          <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">
            Join architects at practices of every size who are accelerating their
            design workflow with ArchAI. Free to start, no credit card required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="archai" size="xl" onClick={onGetStarted}>
              Get Started Free
              <ArrowRight className="h-5 w-5" />
            </Button>
            <Button variant="outline" size="xl">
              Book a Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-archai-black border-t border-archai-graphite px-6 py-16">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-sm bg-archai-orange flex items-center justify-center">
                  <span className="text-white font-bold text-xs">A</span>
                </div>
                <span className="font-semibold text-white text-sm">ArchAI</span>
              </div>
              <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-[180px]">
                AI-native architecture workflow platform for the modern practice.
              </p>
            </div>

            {/* Link groups */}
            {Object.entries(FOOTER_LINKS).map(([group, links]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                  {group}
                </p>
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link}>
                      <a
                        href="#"
                        className="text-xs text-muted-foreground/60 hover:text-white transition-colors"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-archai-graphite pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground/50">
              © {new Date().getFullYear()} ArchAI. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground/30">
              Designed for architects, built with precision.
            </p>
          </div>
        </div>
      </footer>
    </>
  )
}
