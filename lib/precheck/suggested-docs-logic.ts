/**
 * suggested-docs-logic.ts
 *
 * Pure functions for the /api/site-context/suggested-docs feature.
 * Nothing in this file makes network calls or imports Node/Next APIs.
 *
 * Design rules:
 *   - A result must pass HARD REJECT before it is classified.
 *   - A result must have at least one POSITIVE SIGNAL to be classified
 *     as a zoning document. Falling back to UNKNOWN is not enough.
 *   - Only SURFACEABLE classifications are returned to the UI.
 *   - Generic national gov.pl pages are demoted below municipality/BIP/journal.
 *   - Minimum confidence threshold applies before a doc is surfaced.
 *
 * // COUNTRY: Poland
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocClassification =
  | 'ADOPTED_PLAN_TEXT'
  | 'PLAN_DRAWING_ANNEX'
  | 'PLAN_GENERAL_TEXT'
  | 'OFFICIAL_JOURNAL_COPY'
  | 'JUSTIFICATION'
  | 'ENVIRONMENTAL_FORECAST'
  | 'DRAFT_PLAN'          // project/draft plan for public display — not yet adopted
  | 'NOTICE'
  | 'PROCEDURAL_GUIDE'   // instructional / APP / forms / guides
  | 'UNKNOWN'

export interface LocationContext {
  municipality?: string
  locality?: string      // district name or sub-area — NOT a street/address string
  district?: string      // powiat
  province?: string      // województwo
  parcelId?: string
  region?: string        // obręb ewidencyjny code
  address?: string       // full address — used only as last-resort fallback display
}

export interface TrustEntry {
  domain: string
  trust: 'high' | 'medium' | 'low'
  label: string
}

// ── Trust model ───────────────────────────────────────────────────────────────
// Order matters: more specific entries are checked first.
// Generic *.gov.pl is deliberately 'medium' so it never outranks
// municipality-specific BIP / journal sources on trust alone.
// // COUNTRY: Poland

export const TRUSTED_DOMAINS: TrustEntry[] = [
  // Official GUGiK geodata portals
  { domain: 'geoportal.gov.pl',      trust: 'high',   label: 'Geoportal GUGiK' },
  { domain: 'gugik.gov.pl',          trust: 'high',   label: 'GUGiK' },
  // Official journal of laws — national level
  { domain: 'dziennikustaw.gov.pl',  trust: 'high',   label: 'Dziennik Ustaw' },
  // BIP — Public Information Bulletin  (every authority must have one)
  { domain: 'bip.gov.pl',            trust: 'high',   label: 'BIP' },
  // Generic *.gov.pl — medium, not high: includes instructional ministry portals
  // that are NOT local planning documents (e.g. portal.gov.pl, dane.gov.pl, app.gov.pl)
  { domain: 'gov.pl',                trust: 'medium', label: 'Polish Government Portal' },
  // Semi-official MPZP hosting used by many municipalities
  { domain: 'mpzp.net',              trust: 'medium', label: 'MPZP.net' },
  // Voivodeship government portals — official regional authorities
  { domain: 'mazovia.pl',            trust: 'high',   label: 'Masovian Voivodeship' },
  { domain: 'malopolska.pl',         trust: 'high',   label: 'Lesser Poland Voivodeship' },
  { domain: 'slaskie.pl',            trust: 'high',   label: 'Silesian Voivodeship' },
  { domain: 'dolnyslask.pl',         trust: 'high',   label: 'Lower Silesian Voivodeship' },
  { domain: 'lodzkie.pl',            trust: 'high',   label: 'Łódź Voivodeship' },
  { domain: 'lubelskie.pl',          trust: 'high',   label: 'Lublin Voivodeship' },
  { domain: 'podkarpackie.pl',       trust: 'high',   label: 'Subcarpathian Voivodeship' },
  { domain: 'podlaskie.pl',          trust: 'high',   label: 'Podlaskie Voivodeship' },
  { domain: 'pomorskie.pl',          trust: 'high',   label: 'Pomeranian Voivodeship' },
  { domain: 'warmia.mazury.pl',      trust: 'high',   label: 'Warmian-Masurian Voivodeship' },
  { domain: 'wielkopolskie.pl',      trust: 'high',   label: 'Greater Poland Voivodeship' },
  { domain: 'zachodniopomorskie.pl', trust: 'high',   label: 'West Pomeranian Voivodeship' },
  { domain: 'kujawsko-pomorskie.pl', trust: 'high',   label: 'Kuyavian-Pomeranian Voivodeship' },
  { domain: 'lubuskie.pl',           trust: 'high',   label: 'Lubusz Voivodeship' },
  { domain: 'swietokrzyskie.pl',     trust: 'high',   label: 'Świętokrzyskie Voivodeship' },
  { domain: 'opolskie.pl',           trust: 'high',   label: 'Opole Voivodeship' },
]

export function domainTrust(hostname: string): TrustEntry | null {
  // Check static list first (more specific entries win)
  for (const entry of TRUSTED_DOMAINS) {
    if (hostname === entry.domain || hostname.endsWith(`.${entry.domain}`)) {
      return entry
    }
  }
  // BIP convention: bip.X.pl or X.bip.Y.pl — always high trust
  if (/\.bip\.\w+\.pl$/.test(hostname) || hostname.startsWith('bip.')) {
    return { domain: hostname, trust: 'high', label: 'BIP (Public Information Bulletin)' }
  }
  // Municipal / communal office: um.X.pl, ug.X.pl, urzad.X.pl, starostwo.X.pl
  if (/(^|\.)(um|ug|urzad|starostwo)\.\w+\.pl$/.test(hostname)) {
    return { domain: hostname, trust: 'high', label: 'Municipal/Communal Office' }
  }
  return null
}

export function isTrustedUrl(url: string): TrustEntry | null {
  try {
    const { hostname } = new URL(url)
    return domainTrust(hostname)
  } catch {
    return null
  }
}

// ── Hard-reject signals ────────────────────────────────────────────────────────
// Any document matching these keywords in title+filename+snippet is discarded
// before classification. These represent procedural / instructional / forms
// material that is definitively NOT a zoning/rules document.
// Each entry is a lowercase Polish keyword fragment.
// // COUNTRY: Poland

export const HARD_REJECT_KEYWORDS: string[] = [
  // Instructional and guide materials — "jak powstaje mpzp" type brochures
  'materiały instruktażowe',
  'instruktaż',
  'poradnik',
  'przewodnik',
  'jak powstaje',          // "Jak powstaje miejscowy plan..." — informational brochure
  'jak czytać plan',       // reading guides
  'co to jest mpzp',
  'broszura',
  'ulotka',
  // Forms and templates
  'formularz',
  'wzór pisma',
  'wzór wniosku',
  'wzór formularza',
  // APP (Akt Planowania Przestrzennego) — new 2023 reform participation forms
  // These are procedural participation letters, not binding plan documents
  'pismo app',
  'v1_materiały',
  '_app_',
  '_app.',
  'app_pismo',
  // Generic participation / consultation announcements
  'konsultacje społeczne',
  'raport z konsultacji',
  'ankieta',
  'prezentacja na spotkanie',
  // Commencement/initiation notices
  'przystąpienie do sporządzania',
  'ogłoszenie o przystąpieniu',
  'wszczęcie procedury',
  'informacja o wszczęciu',
  // Tender/procurement
  'przetarg',
  'zamówienie publiczne',
  'siwz',
  // Generic ministerial / national-level planning policy documents
  'ministerstwo rozwoju',
  'polityka przestrzenna państwa',
  'krajowa polityka',
]

/**
 * Returns true if the document should be hard-rejected (never shown).
 * Checked against combined title + filename + snippet (lowercased).
 */
export function isHardRejected(title: string, filename: string, snippet: string): boolean {
  const haystack = `${title} ${filename} ${snippet}`.toLowerCase()
  return HARD_REJECT_KEYWORDS.some((kw) => haystack.includes(kw))
}

// ── Positive zoning-document signals ─────────────────────────────────────────
// A result must match at least one of these to be considered a zoning document.
// If none match, the result is classified UNKNOWN and blocked from surfacing.
// // COUNTRY: Poland

export const POSITIVE_ZONING_SIGNALS: string[] = [
  'miejscowy plan zagospodarowania przestrzennego',
  'mpzp',
  'uchwała',          // must occur with a planning context — handled in combination
  'tekst planu',
  'rysunek planu',
  'załącznik graficzny',
  'załącznik nr',     // common for drawing annexes
  'plan ogólny',
  'studium uwarunkowań',
  'dziennik urzędowy',
  'dz. urz.',
  'dziennik ustaw',
  'plan miejscowy',
  'zagospodarowanie przestrzenne',
  'uchwała mpzp',
  'uchwała nr.*mpzp',  // handled as literal substring below (no regex)
]

/**
 * Returns true if the document has at least one positive zoning-document signal.
 * "uchwała" alone is not enough — it is too common across all council decisions.
 * We require it to co-occur with a planning keyword.
 */
export function hasPositiveZoningSignal(title: string, filename: string, snippet: string): boolean {
  const haystack = `${title} ${filename} ${snippet}`.toLowerCase()

  for (const signal of POSITIVE_ZONING_SIGNALS) {
    // Exclude bare 'uchwała' and 'załącznik nr' — require them to co-occur
    if (signal === 'uchwała') continue
    if (signal === 'załącznik nr') {
      // Only count if a spatial-planning keyword also appears
      if (haystack.includes('załącznik nr') && (
        haystack.includes('mpzp') ||
        haystack.includes('planu') ||
        haystack.includes('zagospodarowania')
      )) return true
      continue
    }
    if (haystack.includes(signal)) return true
  }
  return false
}

// ── Classification heuristics ─────────────────────────────────────────────────
// Called only after hard-reject and positive-signal checks pass.
// // COUNTRY: Poland

interface ClassificationRule {
  classification: DocClassification
  keywords: string[]
  antiKeywords?: string[]
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    classification: 'ADOPTED_PLAN_TEXT',
    keywords: [
      'uchwała mpzp',
      'miejscowy plan zagospodarowania przestrzennego',
      'mpzp tekst',
      'tekst uchwały',
      'tekst planu',
      'plan miejscowy',
      'uchwalenie planu',
    ],
    antiKeywords: [
      'przystąpienie', 'ogłoszenie wszczęcia', 'projekt planu',
      'instruktaż', 'materiały', 'formularz',
    ],
  },
  {
    classification: 'PLAN_DRAWING_ANNEX',
    keywords: [
      'rysunek planu', 'rysunek mpzp', 'załącznik graficzny',
      'mapa do planu', 'mapa mpzp', 'plan graficzny',
      'zał. graficzny',
    ],
  },
  {
    classification: 'PLAN_GENERAL_TEXT',
    keywords: [
      'plan ogólny gminy', 'plan ogólny',
      'studium uwarunkowań', 'studium gminne',
      'plan zagospodarowania przestrzennego gminy',
      'uchwała studium',
    ],
  },
  {
    classification: 'OFFICIAL_JOURNAL_COPY',
    keywords: [
      'dziennik urzędowy województwa',
      'dziennik urzędowy',
      'dz. urz.',
      'dziennik ustaw',
      'dz.u.',
      'ogłoszony w dzienniku',
    ],
  },
  {
    classification: 'JUSTIFICATION',
    keywords: [
      'uzasadnienie do planu', 'uzasadnienie mpzp',
      'prognoza społeczno-gospodarcza',
      'ocena skutków finansowych',
    ],
    antiKeywords: ['instruktaż', 'materiały', 'formularz'],
  },
  {
    classification: 'ENVIRONMENTAL_FORECAST',
    keywords: [
      'prognoza oddziaływania na środowisko',
      'prognoza środowiskowa',
      'strategiczna ocena oddziaływania',
      'raport środowiskowy',
    ],
  },
  {
    // Draft/project plans presented for public display — not yet adopted law.
    // These may be useful context but must rank below adopted documents.
    // Trigger: 'projekt' (draft) co-occurring with 'wyłożenie' OR 'wgląd', OR
    // explicit "projekt mpzp / projekt planu" phrases.
    classification: 'DRAFT_PLAN',
    keywords: [
      'projekt miejscowego planu',
      'projekt mpzp',
      'projekt planu miejscowego',
      'wyłożenie projektu',
      'projekt planu do wglądu',
      'wyłożenie do publicznego wglądu',
    ],
  },
  {
    classification: 'PROCEDURAL_GUIDE',
    keywords: [
      'materiały instruktażowe', 'instruktaż', 'poradnik',
      'formularz', 'wzór', 'ankieta', 'konsultacje społeczne',
      'pismo app', 'udział społeczeństwa',
    ],
  },
  {
    classification: 'NOTICE',
    keywords: [
      'przystąpienie do sporządzania',
      'wszczęcie procedury',
      'wyłożenie do wglądu',
      'ogłoszenie o wyłożeniu',
      'zawiadomienie o terminie',
    ],
  },
]

export function classifyDocument(
  title: string,
  filename: string,
  snippet: string,
): DocClassification {
  const haystack = `${title} ${filename} ${snippet}`.toLowerCase()

  for (const rule of CLASSIFICATION_RULES) {
    const hasAnti = rule.antiKeywords?.some((kw) => haystack.includes(kw)) ?? false
    if (hasAnti) continue
    const hasMatch = rule.keywords.some((kw) => haystack.includes(kw))
    if (hasMatch) return rule.classification
  }
  return 'UNKNOWN'
}

// ── Surfaceable classifications ────────────────────────────────────────────────
// Only these classifications are ever shown in the UI.
// NOTICE, PROCEDURAL_GUIDE, and UNKNOWN are not actionable for architects.

// DRAFT_PLAN is intentionally excluded — draft plans for public display are not
// binding rules documents and should not be shown alongside adopted acts.
export const SURFACEABLE_CLASSIFICATIONS: Set<DocClassification> = new Set([
  'ADOPTED_PLAN_TEXT',
  'PLAN_DRAWING_ANNEX',
  'PLAN_GENERAL_TEXT',
  'OFFICIAL_JOURNAL_COPY',
  'JUSTIFICATION',
  'ENVIRONMENTAL_FORECAST',
])

export function isSurfaceable(c: DocClassification): boolean {
  return SURFACEABLE_CLASSIFICATIONS.has(c)
}

// ── Classification ranking ────────────────────────────────────────────────────

export const CLASSIFICATION_RANK: DocClassification[] = [
  'ADOPTED_PLAN_TEXT',
  'PLAN_DRAWING_ANNEX',
  'OFFICIAL_JOURNAL_COPY',
  'PLAN_GENERAL_TEXT',
  'JUSTIFICATION',
  'ENVIRONMENTAL_FORECAST',
  'DRAFT_PLAN',
  'NOTICE',
  'PROCEDURAL_GUIDE',
  'UNKNOWN',
]

export function classificationScore(c: DocClassification): number {
  const idx = CLASSIFICATION_RANK.indexOf(c)
  return idx === -1 ? CLASSIFICATION_RANK.length : idx
}

// ── Source trust score ────────────────────────────────────────────────────────
// Assigns a numeric bonus by trust level and source specificity.
// Municipality BIP / voivodeship journal > generic gov.pl.

export function trustScore(trust: TrustEntry, hostname: string): number {
  // BIP and municipal offices are the most authoritative for local plans
  if (
    trust.trust === 'high' &&
    (hostname.startsWith('bip.') ||
     /\.bip\./.test(hostname) ||
     /(^|\.)(um|ug|urzad|starostwo)\./.test(hostname))
  ) {
    return 50
  }
  // Voivodeship journals and portals
  if (trust.trust === 'high') return 40
  // mpzp.net and similar semi-official
  if (trust.trust === 'medium') return 20
  // low (future use)
  return 10
}

// ── Query generation ──────────────────────────────────────────────────────────
// Deterministic, structured-context-driven.
// Locality MUST be a genuine place name (district/neighbourhood), never a street.
// // COUNTRY: Poland

export function buildSearchQueries(ctx: LocationContext): string[] {
  const queries: string[] = []
  const gmina  = ctx.municipality?.trim()
  const miejsc = ctx.locality?.trim()   // caller must ensure this is a place, not a street
  const woj    = ctx.province?.trim()

  // Tier 1 — most specific: locality within municipality
  // Only emit if locality is clearly different from municipality and looks like a
  // place name (not a street: no digits, not too short).
  if (gmina && miejsc && isLikelyPlaceName(miejsc) && !isSamePlace(gmina, miejsc)) {
    queries.push(`site:bip.${domainSuffix(gmina)} MPZP ${miejsc} pdf`)
    queries.push(`miejscowy plan zagospodarowania przestrzennego ${miejsc} gmina ${gmina} pdf`)
    queries.push(`MPZP ${miejsc} ${gmina} uchwała tekst planu pdf`)
  }

  // Tier 2 — municipality-level MPZP on BIP
  if (gmina) {
    queries.push(`BIP ${gmina} miejscowy plan zagospodarowania przestrzennego pdf uchwała`)
    queries.push(`"miejscowy plan zagospodarowania przestrzennego" "${gmina}" filetype:pdf`)
    queries.push(`MPZP ${gmina} tekst planu uchwała filetype:pdf`)
  }

  // Tier 3 — voivodeship official journal copy
  if (gmina && woj) {
    queries.push(`dziennik urzędowy województwa ${woj} MPZP "${gmina}" pdf`)
  }

  // Tier 4 — plan ogólny / studium (weaker, municipality-wide)
  if (gmina) {
    queries.push(`plan ogólny gminy ${gmina} filetype:pdf`)
  }

  return queries
}

/**
 * Returns true if the string looks like a place name rather than a street address.
 * Rejects strings containing digits (house numbers) or that are very short (< 4 chars).
 */
export function isLikelyPlaceName(s: string): boolean {
  if (!s || s.trim().length < 4) return false
  if (/\d/.test(s)) return false           // contains digit → likely a street+number
  if (/^ul\b|^al\b|^os\b|^pl\b/i.test(s.trim())) return false  // starts with street prefix
  return true
}

/** Loose equality check — handles capitalisation and common suffix variants. */
function isSamePlace(a: string, b: string): boolean {
  return a.toLowerCase().trim() === b.toLowerCase().trim()
}

/**
 * Attempt to derive a BIP-style domain suffix from a municipality name.
 * e.g. "Warszawa" → "warszawa.pl", "Gmina Kraków" → "krakow.pl"
 * This is heuristic — used only for Tier 1 BIP site: queries.
 */
function domainSuffix(municipality: string): string {
  return municipality
    .toLowerCase()
    .replace(/^(gmina|miasto|m\.|gm\.)\s+/i, '')
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
    .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') + '.pl'
}

// ── Confidence scoring ────────────────────────────────────────────────────────
// Returned score should be interpreted as:
//   < MIN_CONFIDENCE_THRESHOLD → do not surface
//   40–59 → weak suggestion
//   60–79 → good suggestion
//   80+   → strong suggestion

export const MIN_CONFIDENCE_THRESHOLD = 45

export function scoreResult(
  result: { title: string; url: string; description: string },
  ctx: LocationContext,
  classification: DocClassification,
  trust: TrustEntry,
): { confidence: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  // Source trust score — BIP/municipal > voivodeship > generic gov
  const hostname = (() => { try { return new URL(result.url).hostname } catch { return '' } })()
  const ts = trustScore(trust, hostname)
  score += ts
  reasons.push(`Source: ${trust.label}`)

  // Classification bonus — higher for more valuable document types
  const rank = classificationScore(classification)
  const classBonus = Math.max(0, 35 - rank * 6)
  score += classBonus
  if (isSurfaceable(classification)) {
    reasons.push(`Type: ${classification.replace(/_/g, ' ').toLowerCase()}`)
  }

  // Location relevance — must match municipality or locality
  const hay = `${result.title} ${result.url} ${result.description}`.toLowerCase()
  let locationMatched = false

  if (ctx.municipality && hay.includes(ctx.municipality.toLowerCase())) {
    score += 20
    locationMatched = true
    reasons.push(`Matches municipality: ${ctx.municipality}`)
  }
  if (
    ctx.locality &&
    isLikelyPlaceName(ctx.locality) &&
    !isSamePlace(ctx.locality, ctx.municipality ?? '') &&
    hay.includes(ctx.locality.toLowerCase())
  ) {
    score += 12
    locationMatched = true
    reasons.push(`Matches locality: ${ctx.locality}`)
  }
  if (ctx.province && hay.includes(ctx.province.toLowerCase())) {
    score += 5
  }

  // Penalty: generic gov.pl page with no location match is likely off-topic
  if (trust.trust === 'medium' && !locationMatched) {
    score -= 20
    reasons.push('No location match — lower confidence')
  }
  // Extra penalty: any gov.pl result that didn't match the municipality
  if (hostname.endsWith('.gov.pl') && !locationMatched) {
    score -= 15
  }

  // Direct PDF link bonus
  if (result.url.toLowerCase().endsWith('.pdf')) {
    score += 8
    reasons.push('Direct PDF link')
  }

  return { confidence: Math.min(100, Math.max(0, score)), reasons }
}

// ── PDF URL extraction ────────────────────────────────────────────────────────
//
// A URL is considered a direct PDF if:
//   1. The pathname ends with .pdf (case-insensitive), OR
//   2. A query param value contains .pdf (e.g. ?file=doc.pdf), OR
//   3. The pathname contains a segment that is a .pdf filename (common in
//      Polish BIP download paths like /system/obj/12345/plan.pdf/bialoleka)
//
// URLs without any of these signals are HTML pages and must not be treated as
// PDF documents. Do NOT fall back to "use the URL anyway" — that is the root
// cause of the HTML-page-as-PDF misclassification bug.

export function extractPdfUrl(
  resultUrl: string,
): { pdfUrl: string; sourcePageUrl?: string } | null {
  try {
    const u    = new URL(resultUrl)
    const path = u.pathname.toLowerCase()

    // Case 1: path ends with .pdf
    if (path.endsWith('.pdf')) {
      return { pdfUrl: resultUrl }
    }

    // Case 2: a query-string param value contains .pdf
    for (const val of u.searchParams.values()) {
      if (val.toLowerCase().includes('.pdf')) {
        return { pdfUrl: resultUrl }
      }
    }

    // Case 3: a path segment is a .pdf filename embedded mid-path
    // (e.g. /system/obj/12345/plan.pdf/pobierz)
    const segments = path.split('/')
    for (const seg of segments) {
      if (seg.endsWith('.pdf')) {
        return { pdfUrl: resultUrl }
      }
    }

    return null
  } catch {
    return null
  }
}
