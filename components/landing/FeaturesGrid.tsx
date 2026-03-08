import {
  Map,
  Box,
  Grid3x3,
  Activity,
  Columns2,
  Leaf,
  BookOpen,
  FileText,
  PenLine,
} from 'lucide-react'

const FEATURES = [
  {
    icon: Map,
    title: 'Site Analysis & Zoning Checker',
    description:
      'Parse local zoning codes, flag setback violations, FAR exceedances, and height limits. Get permit pre-check reports in seconds.',
    badge: 'Code Compliance',
  },
  {
    icon: Box,
    title: 'Instant Massing Generator',
    description:
      'Input a brief and site constraints — AI generates compliant massing options with GFA calculations and 3D model output to your Speckle stream.',
    badge: 'Feasibility',
  },
  {
    icon: Grid3x3,
    title: 'Space Planner & Test-Fit',
    description:
      'Generate space layout alternatives from a room program. AI optimizes circulation, adjacency, and area efficiency automatically.',
    badge: 'Planning',
  },
  {
    icon: Activity,
    title: 'Live Metrics Dashboard',
    description:
      'GFA, efficiency, embodied carbon, and code risk — updated in real-time as your model changes. No more manual calculations.',
    badge: 'Real-Time',
  },
  {
    icon: Columns2,
    title: 'Design Option Comparison',
    description:
      'Compare design alternatives side-by-side across metrics: cost, carbon, program fit, and code compliance. Export comparison reports.',
    badge: 'Decision Support',
  },
  {
    icon: Leaf,
    title: 'Sustainability Copilot',
    description:
      'Real-time embodied carbon tracking. Ladybug-powered solar, wind, and daylighting analysis. Material swaps with carbon impact previews.',
    badge: 'Carbon + Energy',
  },
  {
    icon: BookOpen,
    title: 'Firm Knowledge Assistant',
    description:
      'AI search over your firm\'s past projects, specs, and documents. Ask questions in plain language, get cited answers from your knowledge base.',
    badge: 'RAG / Knowledge',
  },
  {
    icon: FileText,
    title: 'Brief-to-Program Translator',
    description:
      'Paste a client brief. AI extracts a structured architectural program with room types, areas, relationships, and design intent.',
    badge: 'Programming',
  },
  {
    icon: PenLine,
    title: 'Spec Writer & Sketch-to-BIM',
    description:
      'AI-generated specifications from model data. Upload rough sketches and translate them into structured BIM elements via vision AI.',
    badge: 'Documentation',
  },
]

export function FeaturesGrid() {
  return (
    <section id="features" className="py-24 px-6 bg-archai-black">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-xs font-medium tracking-widest uppercase text-archai-orange mb-4">
            The Platform
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-light text-white mb-4">
            Nine tools. One workspace.
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Every AI capability an architectural practice needs, built around your 3D model
            and available at every stage of design.
          </p>
        </div>

        {/* 3-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={feature.title}
                className="group relative rounded-lg border border-archai-graphite bg-archai-charcoal p-6 transition-all duration-300 hover:border-archai-orange/40 hover:bg-archai-graphite/50"
              >
                {/* Top row: icon + badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-md bg-archai-graphite flex items-center justify-center group-hover:bg-archai-orange/10 transition-colors">
                    <Icon className="h-5 w-5 text-muted-foreground group-hover:text-archai-orange transition-colors" />
                  </div>
                  <span className="text-[10px] font-medium tracking-widest uppercase text-archai-orange/70 border border-archai-orange/20 rounded-full px-2 py-0.5">
                    {feature.badge}
                  </span>
                </div>

                <h3 className="font-semibold text-white text-sm mb-2 leading-snug">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {feature.description}
                </p>

                {/* Hover accent line */}
                <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-archai-orange/0 via-archai-orange/40 to-archai-orange/0 opacity-0 group-hover:opacity-100 transition-opacity rounded-b-lg" />
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
