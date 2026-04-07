/**
 * /api/site-context/suggested-docs
 *
 * Discovers candidate official Polish zoning/planning PDF documents for a given
 * location context (municipality, locality, province, parcel identifiers).
 *
 * Strategy:
 *   1. Build deterministic search queries from structured location context.
 *   2. For each query, search for candidate pages using the Brave Search API
 *      (or fall back to a DuckDuckGo HTML scrape when BRAVE_SEARCH_API_KEY is absent).
 *   3. Filter results to official / high-trust Polish government domains.
 *   4. Classify each candidate by filename, title, snippet heuristics.
 *   5. Rank by classification preference + source trust + locality match.
 *   6. Return typed SuggestedZoningDocument objects ready for the ZoningDocPanel.
 *
 * Pure logic (classifyDocument, buildSearchQueries, scoreResult, isTrustedUrl,
 * classificationScore, extractPdfUrl) lives in lib/precheck/suggested-docs-logic.ts
 * so it can be unit-tested without a running server.
 *
 * The endpoint intentionally does NOT extract or infer zoning rules — it only
 * finds and suggests documents. LLM calls are avoided; all logic is deterministic.
 *
 * Query params (all optional — use as many as available):
 *   municipality  — gmina name  (e.g. "Warszawa")
 *   locality      — miejscowość (e.g. "Wilanów")
 *   district      — powiat      (e.g. "Warszawa")
 *   province      — województwo (e.g. "mazowieckie")
 *   parcelId      — ULDK parcel number within obręb (e.g. "24/35")
 *   region        — obręb ewidencyjny code (e.g. "0001")
 *   address       — fallback free-text address
 *
 * // COUNTRY: Poland
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  buildSearchQueries,
  classifyDocument,
  classificationScore,
  extractPdfUrl,
  hasPositiveZoningSignal,
  isHardRejected,
  isSurfaceable,
  isTrustedUrl,
  MIN_CONFIDENCE_THRESHOLD,
  scoreResult,
  type LocationContext,
} from '@/lib/precheck/suggested-docs-logic'
import type { DocClassification, SuggestedZoningDocument } from '@/lib/precheck/types'

// ── Brave Search integration ──────────────────────────────────────────────────

interface BraveSearchResult {
  title: string
  url: string
  description: string
  extra_snippets?: string[]
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[]
  }
}

async function searchBrave(
  query: string,
  apiKey: string,
  limit = 10,
): Promise<BraveSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    country: 'PL',
    search_lang: 'pl',
    count: String(limit),
    result_filter: 'web',
  })

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(8_000),
  })

  if (!res.ok) {
    console.warn('[suggested-docs] Brave Search returned', res.status)
    return []
  }

  const data = await res.json() as BraveSearchResponse
  return data.web?.results ?? []
}

// ── DuckDuckGo HTML fallback ──────────────────────────────────────────────────
// Used when BRAVE_SEARCH_API_KEY is absent. Scrapes DDG HTML results.
// Less reliable than Brave but avoids hard dependency on a paid API key.

interface DdgResult {
  title: string
  url: string
  description: string
}

async function searchDuckDuckGo(query: string): Promise<DdgResult[]> {
  const params = new URLSearchParams({ q: query, kl: 'pl-pl', kp: '-1' })
  let html: string
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArchAI/1.0; zoning-doc-discovery)' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    html = await res.text()
  } catch {
    return []
  }

  const results: DdgResult[] = []
  const linkRe    = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
  const snippetRe = /class="result__snippet"[^>]*>([^<]+)<\/a>/g

  const links: { url: string; title: string }[] = []
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null && links.length < 10) {
    const rawUrl = m[1] ?? ''
    const title  = m[2]?.trim() ?? ''
    try {
      const wrapped = new URL(rawUrl, 'https://html.duckduckgo.com')
      const realUrl = wrapped.searchParams.get('uddg') ?? rawUrl
      links.push({ url: decodeURIComponent(realUrl), title })
    } catch {
      links.push({ url: rawUrl, title })
    }
  }

  const snippets: string[] = []
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(m[1]?.trim() ?? '')
  }

  for (let i = 0; i < links.length; i++) {
    results.push({
      url:         links[i]?.url ?? '',
      title:       links[i]?.title ?? '',
      description: snippets[i] ?? '',
    })
  }

  return results
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicateDocs(docs: SuggestedZoningDocument[]): SuggestedZoningDocument[] {
  const seen = new Set<string>()
  return docs.filter((d) => {
    const key = d.pdfUrl.toLowerCase().replace(/[?#].*$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Main route handler ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const ctx: LocationContext = {
    municipality: searchParams.get('municipality') ?? undefined,
    locality:     searchParams.get('locality')     ?? undefined,
    district:     searchParams.get('district')     ?? undefined,
    province:     searchParams.get('province')     ?? undefined,
    parcelId:     searchParams.get('parcelId')     ?? undefined,
    region:       searchParams.get('region')       ?? undefined,
    address:      searchParams.get('address')      ?? undefined,
  }

  if (!ctx.municipality && !ctx.address) {
    return NextResponse.json(
      { error: 'At least municipality or address is required', docs: [] },
      { status: 400 },
    )
  }

  console.log('[suggested-docs] ctx:', JSON.stringify(ctx))

  const queries  = buildSearchQueries(ctx)
  const braveKey = process.env.BRAVE_SEARCH_API_KEY

  console.log('[suggested-docs] queries:', queries)

  // Collect raw search results across queries, deduplicated by URL
  const rawResultsByUrl = new Map<string, { title: string; url: string; description: string }>()
  const MAX_QUERIES = 4

  for (const query of queries.slice(0, MAX_QUERIES)) {
    const results = braveKey
      ? await searchBrave(query, braveKey)
      : await searchDuckDuckGo(query)

    for (const r of results) {
      if (!rawResultsByUrl.has(r.url)) {
        rawResultsByUrl.set(r.url, r)
      }
    }

    // Stop early if we already have plenty of trusted candidates
    const trustedSoFar = [...rawResultsByUrl.values()].filter((r) => isTrustedUrl(r.url))
    if (trustedSoFar.length >= 12) break
  }

  console.log('[suggested-docs] raw results total:', rawResultsByUrl.size)

  // Filter, classify, score — gate order matters:
  //   1. Domain trust check (reject non-official sources)
  //   2. Hard reject (procedural / instructional / forms material)
  //   3. Positive zoning signal required
  //   4. Classify
  //   5. Surfaceability check (drop NOTICE, PROCEDURAL_GUIDE, UNKNOWN)
  //   6. Score
  //   7. Minimum confidence threshold
  const docs: SuggestedZoningDocument[] = []

  for (const result of rawResultsByUrl.values()) {
    // Gate 1: domain trust
    const trust = isTrustedUrl(result.url)
    if (!trust) continue

    const filename = result.url.split('/').pop() ?? ''

    // Gate 2: hard reject — procedural / instructional / forms material
    if (isHardRejected(result.title, filename, result.description)) {
      console.log('[suggested-docs] hard-rejected:', result.url, '|', result.title)
      continue
    }

    // Gate 3: at least one positive zoning-document signal must be present
    if (!hasPositiveZoningSignal(result.title, filename, result.description)) {
      console.log('[suggested-docs] no positive signal, skipped:', result.url, '|', result.title)
      continue
    }

    const pdfExtract = extractPdfUrl(result.url)

    // Gate 3b: require a direct PDF URL.
    // HTML pages (no .pdf signal in URL) are landing pages, not documents.
    // We must NOT treat an HTML page URL as a pdfUrl — that causes the browser
    // to try to open/download HTML as a PDF (and throws a ByteString error in
    // the fetch-document route when the Content-Type comes back as text/html).
    // Future work: crawl the page to extract linked PDF URLs. For now, skip.
    if (!pdfExtract) {
      console.log('[suggested-docs] no PDF URL, skipping HTML landing page:', result.url)
      continue
    }

    const pdfUrl        = pdfExtract.pdfUrl
    const sourcePageUrl = pdfExtract.sourcePageUrl

    // Gate 4: classify
    const classification = classifyDocument(result.title, filename, result.description)

    // Gate 5: only surfaceable classifications are shown
    if (!isSurfaceable(classification)) {
      console.log('[suggested-docs] not surfaceable:', classification, '|', result.url)
      continue
    }

    // Gate 6: score
    const { confidence, reasons } = scoreResult(result, ctx, classification, trust)

    // Gate 7: minimum confidence threshold — return nothing rather than junk
    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      console.log(`[suggested-docs] below threshold (${confidence}):`, result.url)
      continue
    }

    docs.push({
      id:              crypto.randomUUID(),
      title:           result.title || filename || 'Zoning Document',
      // isSurfaceable gate above guarantees classification is a surfaceable
      // API classification — cast from internal DocClassification (which includes
      // PROCEDURAL_GUIDE/NOTICE/UNKNOWN) to the narrower API union.
      classification:  classification as DocClassification,
      sourceAuthority: trust.label,
      sourceDomain:    new URL(result.url).hostname,
      sourcePageUrl,
      pdfUrl,
      confidence,
      reasons,
    })
  }

  // Sort: confidence desc, then classification rank asc
  docs.sort((a, b) => {
    const confDiff = b.confidence - a.confidence
    if (confDiff !== 0) return confDiff
    return classificationScore(a.classification) - classificationScore(b.classification)
  })

  const limited = deduplicateDocs(docs).slice(0, 12)

  console.log(`[suggested-docs] returning ${limited.length} docs`)

  return NextResponse.json(
    { docs: limited },
    {
      headers: {
        // Cache for 10 minutes — same location context yields same results
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
      },
    },
  )
}
