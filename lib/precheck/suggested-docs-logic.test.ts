/**
 * suggested-docs-logic.test.ts
 *
 * Unit tests for the deterministic zoning-document discovery logic.
 * No network calls, no Next.js server, no database required.
 *
 * Run with:
 *   npx tsx --test lib/precheck/suggested-docs-logic.test.ts
 *
 * // COUNTRY: Poland
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildSearchQueries,
  classifyDocument,
  classificationScore,
  domainTrust,
  extractPdfUrl,
  hasPositiveZoningSignal,
  isHardRejected,
  isLikelyPlaceName,
  isSurfaceable,
  isTrustedUrl,
  MIN_CONFIDENCE_THRESHOLD,
  scoreResult,
  CLASSIFICATION_RANK,
  type LocationContext,
  type TrustEntry,
} from './suggested-docs-logic'

// ── Regression: the bad example must be rejected ─────────────────────────────

describe('regression: V1_MATERIAŁY_INSTRUKTAŻOWE_PISMO_APP', () => {
  const TITLE    = 'V1_MATERIAŁY_INSTRUKTAŻOWE_PISMO_APP - Portal Gov.pl'
  const FILENAME = 'V1_MATERIAŁY_INSTRUKTAŻOWE_PISMO_APP.pdf'
  const SNIPPET  = 'Materiały instruktażowe dotyczące pism APP w ramach konsultacji społecznych.'

  it('is hard-rejected', () => {
    assert.ok(
      isHardRejected(TITLE, FILENAME, SNIPPET),
      'Expected V1_MATERIAŁY_INSTRUKTAŻOWE_PISMO_APP to be hard-rejected',
    )
  })

  it('has no positive zoning signal', () => {
    assert.ok(
      !hasPositiveZoningSignal(TITLE, FILENAME, SNIPPET),
      'Expected no positive zoning signal for instructional APP material',
    )
  })

  it('is classified PROCEDURAL_GUIDE', () => {
    assert.equal(classifyDocument(TITLE, FILENAME, SNIPPET), 'PROCEDURAL_GUIDE')
  })

  it('is not surfaceable', () => {
    assert.ok(!isSurfaceable('PROCEDURAL_GUIDE'))
    assert.ok(!isSurfaceable('UNKNOWN'))
    assert.ok(!isSurfaceable('NOTICE'))
  })

  it('scores below MIN_CONFIDENCE_THRESHOLD even on a trusted domain', () => {
    // Even if we bypassed the hard-reject and positive-signal gates (which we wouldn't),
    // the confidence score should be below the threshold because there is no location match
    // and the generic gov.pl penalty applies.
    const highTrustMedium: TrustEntry = { domain: 'gov.pl', trust: 'medium', label: 'Polish Government Portal' }
    const result = { title: TITLE, url: 'https://portal.gov.pl/V1_MATERIAŁY_INSTRUKTAŻOWE_PISMO_APP.pdf', description: SNIPPET }
    const ctx: LocationContext = { municipality: 'Warszawa' }
    const { confidence } = scoreResult(result, ctx, 'PROCEDURAL_GUIDE', highTrustMedium)
    assert.ok(
      confidence < MIN_CONFIDENCE_THRESHOLD,
      `Expected confidence ${confidence} to be below threshold ${MIN_CONFIDENCE_THRESHOLD}`,
    )
  })
})

// ── isHardRejected ────────────────────────────────────────────────────────────

describe('isHardRejected', () => {
  it('rejects instruktaż in title', () => {
    assert.ok(isHardRejected('Materiały instruktażowe dla wnioskodawców', '', ''))
  })
  it('rejects formularz in filename', () => {
    assert.ok(isHardRejected('', 'formularz-wniosku.pdf', ''))
  })
  it('rejects wzór pisma in snippet', () => {
    assert.ok(isHardRejected('', '', 'wzór pisma do urzędu gminy'))
  })
  it('rejects pismo app in title', () => {
    assert.ok(isHardRejected('Pismo APP do właściciela nieruchomości', '', ''))
  })
  it('rejects konsultacje społeczne in snippet', () => {
    assert.ok(isHardRejected('', '', 'raport z konsultacji społecznych dotyczący planu'))
  })
  it('rejects przystąpienie do sporządzania', () => {
    assert.ok(isHardRejected('Ogłoszenie o przystąpieniu do sporządzania MPZP', '', ''))
  })
  it('does NOT reject a legitimate adopted plan PDF', () => {
    assert.ok(!isHardRejected(
      'Uchwała Nr XV/123/2022 MPZP dla obszaru Śródmieście',
      'mpzp-srodmiescie-tekst.pdf',
      'Tekst planu miejscowego zagospodarowania przestrzennego',
    ))
  })
  it('does NOT reject an official journal copy', () => {
    assert.ok(!isHardRejected(
      'Dziennik Urzędowy Województwa Mazowieckiego poz. 4521',
      'dz-urz-maz-4521.pdf',
      'Ogłoszono w Dzienniku Urzędowym',
    ))
  })
})

// ── hasPositiveZoningSignal ───────────────────────────────────────────────────

describe('hasPositiveZoningSignal', () => {
  it('detects mpzp keyword', () => {
    assert.ok(hasPositiveZoningSignal('Plan MPZP centrum', '', ''))
  })
  it('detects miejscowy plan zagospodarowania przestrzennego', () => {
    assert.ok(hasPositiveZoningSignal('', '', 'Miejscowy plan zagospodarowania przestrzennego gminy'))
  })
  it('detects tekst planu', () => {
    assert.ok(hasPositiveZoningSignal('Tekst planu', 'tekst.pdf', ''))
  })
  it('detects rysunek planu', () => {
    assert.ok(hasPositiveZoningSignal('Rysunek planu załącznik graficzny', '', ''))
  })
  it('detects dziennik urzędowy', () => {
    assert.ok(hasPositiveZoningSignal('', 'dz-urz.pdf', 'Dziennik Urzędowy Województwa'))
  })
  it('detects plan ogólny', () => {
    assert.ok(hasPositiveZoningSignal('Plan ogólny gminy Wrocław', '', ''))
  })
  it('detects studium uwarunkowań', () => {
    assert.ok(hasPositiveZoningSignal('Studium uwarunkowań i kierunków', '', ''))
  })
  it('does NOT trigger on bare "uchwała" alone', () => {
    // "uchwała" by itself appears in all council decisions — not specific enough
    assert.ok(!hasPositiveZoningSignal('Uchwała Nr XII/89/2022 Rady Gminy', 'uchwala.pdf', ''))
  })
  it('detects załącznik nr when co-occurring with mpzp', () => {
    assert.ok(hasPositiveZoningSignal('Załącznik nr 1 do MPZP', '', ''))
  })
  it('does NOT trigger on unrelated "załącznik nr"', () => {
    assert.ok(!hasPositiveZoningSignal('Załącznik nr 1 do budżetu gminy', 'budzet.pdf', ''))
  })
  it('returns false for instructional material', () => {
    assert.ok(!hasPositiveZoningSignal(
      'V1_MATERIAŁY_INSTRUKTAŻOWE_PISMO_APP',
      'instruktaz.pdf',
      'Instruktażowe materiały APP',
    ))
  })
})

// ── isLikelyPlaceName ─────────────────────────────────────────────────────────

describe('isLikelyPlaceName', () => {
  it('accepts a neighbourhood name', () => {
    assert.ok(isLikelyPlaceName('Wilanów'))
    assert.ok(isLikelyPlaceName('Śródmieście'))
    assert.ok(isLikelyPlaceName('Nowa Huta'))
  })
  it('rejects a street+number (contains digit)', () => {
    assert.ok(!isLikelyPlaceName('Chmielna 69'))
    assert.ok(!isLikelyPlaceName('ul. Marszałkowska 10'))
    assert.ok(!isLikelyPlaceName('00-801 Warszawa'))
  })
  it('rejects common street prefixes', () => {
    assert.ok(!isLikelyPlaceName('ul. Długa'))
    assert.ok(!isLikelyPlaceName('al. Jerozolimskie'))
    assert.ok(!isLikelyPlaceName('os. Kazimierz'))
    assert.ok(!isLikelyPlaceName('pl. Zamkowy'))
  })
  it('rejects very short strings', () => {
    assert.ok(!isLikelyPlaceName(''))
    assert.ok(!isLikelyPlaceName('Wwa'))
    assert.ok(!isLikelyPlaceName(undefined as unknown as string))
  })
})

// ── classifyDocument ──────────────────────────────────────────────────────────

describe('classifyDocument', () => {
  it('classifies adopted plan text', () => {
    assert.equal(
      classifyDocument('Uchwała MPZP tekst planu dla dzielnicy Śródmieście', 'mpzp.pdf', ''),
      'ADOPTED_PLAN_TEXT',
    )
  })
  it('classifies drawing annex', () => {
    assert.equal(
      classifyDocument('Rysunek planu — Załącznik graficzny nr 1', 'rysunek.pdf', ''),
      'PLAN_DRAWING_ANNEX',
    )
  })
  it('classifies general plan (plan ogólny)', () => {
    assert.equal(
      classifyDocument('Plan ogólny gminy Gdańsk', 'plan-ogolny.pdf', ''),
      'PLAN_GENERAL_TEXT',
    )
  })
  it('classifies official journal copy', () => {
    assert.equal(
      classifyDocument('Dziennik Urzędowy Województwa Mazowieckiego poz. 4521', 'dz-urz.pdf', ''),
      'OFFICIAL_JOURNAL_COPY',
    )
  })
  it('classifies justification', () => {
    assert.equal(
      classifyDocument('Uzasadnienie do planu miejscowego', 'uzasadnienie.pdf', ''),
      'JUSTIFICATION',
    )
  })
  it('classifies environmental forecast', () => {
    assert.equal(
      classifyDocument('Prognoza oddziaływania na środowisko', 'prognoza.pdf', ''),
      'ENVIRONMENTAL_FORECAST',
    )
  })
  it('classifies procedural guide correctly', () => {
    assert.equal(
      classifyDocument('Materiały instruktażowe MPZP dla wnioskodawców', 'instruktaz.pdf', ''),
      'PROCEDURAL_GUIDE',
    )
  })
  it('classifies notice correctly', () => {
    assert.equal(
      classifyDocument('Wyłożenie do wglądu projektu planu', 'wylozenie.pdf', ''),
      'NOTICE',
    )
  })
  it('returns UNKNOWN for unrelated documents', () => {
    assert.equal(
      classifyDocument('Budżet gminy 2024', 'budzet.pdf', ''),
      'UNKNOWN',
    )
  })
  it('antiKeyword blocks ADOPTED_PLAN_TEXT for project draft', () => {
    const cls = classifyDocument('Projekt planu miejscowego — wersja robocza', '', '')
    assert.notEqual(cls, 'ADOPTED_PLAN_TEXT')
  })
})

// ── isSurfaceable ─────────────────────────────────────────────────────────────

describe('isSurfaceable', () => {
  it('surfaces adopted plan text', () => assert.ok(isSurfaceable('ADOPTED_PLAN_TEXT')))
  it('surfaces drawing annex',     () => assert.ok(isSurfaceable('PLAN_DRAWING_ANNEX')))
  it('surfaces general plan',      () => assert.ok(isSurfaceable('PLAN_GENERAL_TEXT')))
  it('surfaces official journal',  () => assert.ok(isSurfaceable('OFFICIAL_JOURNAL_COPY')))
  it('surfaces justification',     () => assert.ok(isSurfaceable('JUSTIFICATION')))
  it('surfaces environmental',     () => assert.ok(isSurfaceable('ENVIRONMENTAL_FORECAST')))
  it('does NOT surface NOTICE',           () => assert.ok(!isSurfaceable('NOTICE')))
  it('does NOT surface PROCEDURAL_GUIDE', () => assert.ok(!isSurfaceable('PROCEDURAL_GUIDE')))
  it('does NOT surface UNKNOWN',          () => assert.ok(!isSurfaceable('UNKNOWN')))
})

// ── classificationScore / ranking ────────────────────────────────────────────

describe('classificationScore', () => {
  it('ADOPTED_PLAN_TEXT ranks highest (score 0)', () => {
    assert.equal(classificationScore('ADOPTED_PLAN_TEXT'), 0)
  })
  it('UNKNOWN ranks lowest', () => {
    assert.equal(classificationScore('UNKNOWN'), CLASSIFICATION_RANK.length - 1)
  })
  it('ADOPTED_PLAN_TEXT < NOTICE', () => {
    assert.ok(classificationScore('ADOPTED_PLAN_TEXT') < classificationScore('NOTICE'))
  })
  it('PLAN_DRAWING_ANNEX < OFFICIAL_JOURNAL_COPY', () => {
    assert.ok(classificationScore('PLAN_DRAWING_ANNEX') < classificationScore('OFFICIAL_JOURNAL_COPY'))
  })
  it('PROCEDURAL_GUIDE ranks below NOTICE', () => {
    assert.ok(classificationScore('PROCEDURAL_GUIDE') > classificationScore('NOTICE'))
  })
})

// ── domainTrust / isTrustedUrl ────────────────────────────────────────────────

describe('domainTrust', () => {
  it('trusts bip.krakow.pl as high', () => {
    const t = domainTrust('bip.krakow.pl')
    assert.ok(t !== null)
    assert.equal(t?.trust, 'high')
  })
  it('trusts *.bip.*.pl pattern as high', () => {
    const t = domainTrust('mpzp.bip.krakow.pl')
    assert.ok(t !== null)
    assert.equal(t?.trust, 'high')
  })
  it('trusts geoportal.gov.pl as high', () => {
    const t = domainTrust('geoportal.gov.pl')
    assert.equal(t?.trust, 'high')
  })
  it('assigns MEDIUM trust to generic portal.gov.pl (not high)', () => {
    // portal.gov.pl is a subdomain of gov.pl which is listed as medium
    const t = domainTrust('portal.gov.pl')
    assert.ok(t !== null)
    assert.equal(t?.trust, 'medium')
  })
  it('assigns MEDIUM trust to app.gov.pl', () => {
    const t = domainTrust('app.gov.pl')
    assert.ok(t !== null)
    assert.equal(t?.trust, 'medium')
  })
  it('trusts um.warszawa.pl as high (municipal office)', () => {
    const t = domainTrust('um.warszawa.pl')
    assert.ok(t !== null)
    assert.equal(t?.trust, 'high')
  })
  it('trusts voivodeship portals as high', () => {
    assert.equal(domainTrust('www.mazovia.pl')?.trust, 'high')
    assert.equal(domainTrust('bip.malopolska.pl')?.trust, 'high')
  })
  it('rejects commercial domains', () => {
    assert.equal(domainTrust('dzialki.pl'), null)
    assert.equal(domainTrust('nieruchomosci.pl'), null)
    assert.equal(domainTrust('google.com'), null)
  })
  it('rejects non-Polish TLDs', () => {
    assert.equal(domainTrust('example.com'), null)
    assert.equal(domainTrust('plan.de'), null)
  })
})

describe('isTrustedUrl', () => {
  it('returns trust entry for a trusted URL', () => {
    assert.ok(isTrustedUrl('https://bip.warszawa.pl/mpzp.pdf') !== null)
  })
  it('returns null for malformed URL', () => {
    assert.equal(isTrustedUrl('not a url'), null)
  })
  it('returns null for untrusted domain', () => {
    assert.equal(isTrustedUrl('https://random-site.pl/plan.pdf'), null)
  })
})

// ── buildSearchQueries ────────────────────────────────────────────────────────

describe('buildSearchQueries', () => {
  it('produces municipality-level MPZP queries', () => {
    const q = buildSearchQueries({ municipality: 'Kraków' })
    assert.ok(q.length > 0)
    assert.ok(q.some((s) => s.includes('Kraków')))
    assert.ok(q.some((s) => s.toLowerCase().includes('miejscowy plan') || s.toLowerCase().includes('mpzp')))
  })

  it('includes BIP-targeted query for municipality', () => {
    const q = buildSearchQueries({ municipality: 'Gdańsk' })
    assert.ok(q.some((s) => s.toLowerCase().includes('bip')))
  })

  it('includes locality-specific queries when locality is a valid place name', () => {
    const q = buildSearchQueries({ municipality: 'Warszawa', locality: 'Wilanów' })
    assert.ok(q.some((s) => s.includes('Wilanów') && s.includes('Warszawa')))
  })

  it('does NOT produce locality queries for street-like locality', () => {
    // "Chmielna 69" contains a digit — should be rejected by isLikelyPlaceName
    const q = buildSearchQueries({ municipality: 'Warszawa', locality: 'Chmielna 69' })
    assert.ok(!q.some((s) => s.includes('Chmielna 69')),
      'Street+number locality must NOT appear in queries')
  })

  it('does NOT produce locality queries when locality equals municipality', () => {
    const q = buildSearchQueries({ municipality: 'Kraków', locality: 'Kraków' })
    assert.ok(!q.some((s) => s.includes('Kraków Kraków')))
  })

  it('includes voivodeship journal query when province provided', () => {
    const q = buildSearchQueries({ municipality: 'Gdańsk', province: 'pomorskie' })
    assert.ok(q.some((s) => s.includes('pomorskie') && s.includes('Gdańsk')))
  })

  it('includes plan ogólny query', () => {
    const q = buildSearchQueries({ municipality: 'Wrocław' })
    assert.ok(q.some((s) => s.includes('plan ogólny')))
  })

  it('returns empty array when context is empty', () => {
    assert.deepEqual(buildSearchQueries({}), [])
  })

  it('does NOT use raw address as locality', () => {
    // This is the exact bad pattern from the regression
    const q = buildSearchQueries({
      municipality: 'Warszawa',
      locality: undefined,        // should be undefined, not "Chmielna 69"
      address: 'Chmielna 69, 00-801 Warszawa, województwo mazowieckie, Polska',
    })
    // The full address string must NOT appear embedded in queries
    assert.ok(!q.some((s) => s.includes('Chmielna 69')))
  })
})

// ── scoreResult ───────────────────────────────────────────────────────────────

describe('scoreResult', () => {
  const bipTrust: TrustEntry  = { domain: 'bip.krakow.pl', trust: 'high', label: 'BIP' }
  const govTrust: TrustEntry  = { domain: 'gov.pl', trust: 'medium', label: 'Polish Government Portal' }

  it('BIP source scores higher than generic gov.pl for same classification', () => {
    const ctx: LocationContext = { municipality: 'Kraków' }
    const r = { title: 'Plan MPZP Kraków tekst planu', url: 'https://bip.krakow.pl/plan.pdf', description: 'Kraków' }
    const { confidence: bipConf } = scoreResult(r, ctx, 'ADOPTED_PLAN_TEXT', bipTrust)
    const rGov = { ...r, url: 'https://portal.gov.pl/plan.pdf' }
    const { confidence: govConf } = scoreResult(rGov, ctx, 'ADOPTED_PLAN_TEXT', govTrust)
    assert.ok(bipConf > govConf, `BIP (${bipConf}) should score higher than gov.pl (${govConf})`)
  })

  it('generic gov.pl with no location match falls below threshold', () => {
    const ctx: LocationContext = { municipality: 'Kraków' }
    // Title/URL/desc contain no mention of Kraków → no location match
    const r = { title: 'Instrukcja APP ogólna', url: 'https://portal.gov.pl/app-instrukcja.pdf', description: 'Materiały ogólne' }
    const { confidence } = scoreResult(r, ctx, 'ADOPTED_PLAN_TEXT', govTrust)
    assert.ok(
      confidence < MIN_CONFIDENCE_THRESHOLD,
      `Expected confidence ${confidence} below threshold ${MIN_CONFIDENCE_THRESHOLD} for no-location-match gov.pl`,
    )
  })

  it('municipality name match adds score', () => {
    const ctx: LocationContext = { municipality: 'Kraków' }
    const with_match    = { title: 'MPZP Kraków Stare Miasto tekst planu', url: 'https://bip.krakow.pl/plan.pdf', description: '' }
    const without_match = { title: 'MPZP Stare Miasto tekst planu',        url: 'https://bip.krakow.pl/plan.pdf', description: '' }
    const { confidence: c1 } = scoreResult(with_match,    ctx, 'ADOPTED_PLAN_TEXT', bipTrust)
    const { confidence: c2 } = scoreResult(without_match, ctx, 'ADOPTED_PLAN_TEXT', bipTrust)
    assert.ok(c1 > c2)
  })

  it('direct PDF URL earns bonus', () => {
    // Use a weaker classification so the +8 PDF bonus is visible before the 100 cap.
    // JUSTIFICATION rank=4 → classBonus = max(0, 35-24) = 11; base = 40+11+20 = 71,
    // so pdf = 71+8 = 79 and page = 71.
    const vTrust: TrustEntry = { domain: 'malopolska.pl', trust: 'high', label: 'Voivodeship' }
    const ctx: LocationContext = { municipality: 'Nowy Sącz' }
    const pdf  = { title: 'Uzasadnienie MPZP Nowy Sącz', url: 'https://bip.malopolska.pl/uzasadnienie.pdf', description: 'Nowy Sącz' }
    const page = { title: 'Uzasadnienie MPZP Nowy Sącz', url: 'https://bip.malopolska.pl/uzasadnienie',     description: 'Nowy Sącz' }
    const { confidence: c1 } = scoreResult(pdf,  ctx, 'JUSTIFICATION', vTrust)
    const { confidence: c2 } = scoreResult(page, ctx, 'JUSTIFICATION', vTrust)
    assert.ok(c1 > c2, `PDF (${c1}) should outscore HTML page (${c2})`)
  })

  it('confidence is capped at 100', () => {
    const ctx: LocationContext = { municipality: 'Gdańsk', locality: 'Gdańsk', province: 'pomorskie' }
    const r = { title: 'Gdańsk MPZP plan tekst planu Gdańsk pomorskie', url: 'https://bip.gdansk.pl/plan.pdf', description: 'Gdańsk' }
    const { confidence } = scoreResult(r, ctx, 'ADOPTED_PLAN_TEXT', bipTrust)
    assert.ok(confidence <= 100)
  })

  it('reasons array is non-empty', () => {
    const ctx: LocationContext = { municipality: 'Łódź' }
    const r = { title: 'Plan MPZP Łódź', url: 'https://bip.lodz.pl/plan.pdf', description: '' }
    const { reasons } = scoreResult(r, ctx, 'ADOPTED_PLAN_TEXT', bipTrust)
    assert.ok(reasons.length > 0)
  })

  it('confidence is non-negative', () => {
    const ctx: LocationContext = {}
    const r = { title: 'Something', url: 'https://portal.gov.pl/x.pdf', description: '' }
    const { confidence } = scoreResult(r, ctx, 'UNKNOWN', govTrust)
    assert.ok(confidence >= 0)
  })
})

// ── extractPdfUrl ─────────────────────────────────────────────────────────────

describe('extractPdfUrl', () => {
  it('recognises .pdf URL', () => {
    const r = extractPdfUrl('https://bip.krakow.pl/docs/mpzp.pdf')
    assert.ok(r !== null)
    assert.equal(r?.pdfUrl, 'https://bip.krakow.pl/docs/mpzp.pdf')
  })
  it('returns null for HTML URL — regression: architektura.um.warszawa.pl/bialoleka', () => {
    // This is the exact URL that slipped through as a "PDF" in the original bug.
    // It must return null so the candidate is skipped, not sent to fetch-document.
    assert.equal(extractPdfUrl('https://architektura.um.warszawa.pl/bialoleka'), null)
  })
  it('returns null for generic HTML URL with no extension', () => {
    assert.equal(extractPdfUrl('https://bip.krakow.pl/mpzp/lista'), null)
  })
  it('handles uppercase .PDF', () => {
    assert.ok(extractPdfUrl('https://bip.krakow.pl/MPZP.PDF') !== null)
  })
  it('returns null for malformed URL', () => {
    assert.equal(extractPdfUrl('not a url'), null)
  })
  it('detects .pdf embedded in query param value', () => {
    const r = extractPdfUrl('https://bip.example.pl/pobierz?file=mpzp-2023.pdf')
    assert.ok(r !== null)
  })
  it('detects .pdf segment embedded mid-path (BIP download pattern)', () => {
    // Pattern: /system/obj/12345/plan.pdf/bialoleka
    const r = extractPdfUrl('https://bip.example.pl/system/obj/12345/plan.pdf/pobierz')
    assert.ok(r !== null)
  })
})

// ── DRAFT_PLAN classification ─────────────────────────────────────────────────

describe('DRAFT_PLAN classification', () => {
  it('classifies wyłożenie projektu as DRAFT_PLAN', () => {
    assert.equal(
      classifyDocument('Projekt miejscowego planu MPZP — wyłożenie do publicznego wglądu', 'projekt.pdf', ''),
      'DRAFT_PLAN',
    )
  })
  it('classifies projekt mpzp as DRAFT_PLAN', () => {
    assert.equal(
      classifyDocument('Projekt MPZP dla dzielnicy Wola', 'projekt-mpzp-wola.pdf', ''),
      'DRAFT_PLAN',
    )
  })
  it('DRAFT_PLAN is NOT surfaceable', () => {
    assert.ok(!isSurfaceable('DRAFT_PLAN'))
  })
  it('DRAFT_PLAN ranks below ENVIRONMENTAL_FORECAST but above NOTICE', () => {
    assert.ok(
      classificationScore('DRAFT_PLAN') > classificationScore('ENVIRONMENTAL_FORECAST'),
      'DRAFT_PLAN should rank lower than ENVIRONMENTAL_FORECAST',
    )
    assert.ok(
      classificationScore('DRAFT_PLAN') < classificationScore('NOTICE'),
      'DRAFT_PLAN should rank higher than NOTICE',
    )
  })
  it('adopted UCHWAŁA ranks above DRAFT_PLAN', () => {
    assert.ok(classificationScore('ADOPTED_PLAN_TEXT') < classificationScore('DRAFT_PLAN'))
  })
})

// ── Brochure hard-reject ──────────────────────────────────────────────────────

describe('brochure hard-reject', () => {
  it('rejects "Jak powstaje miejscowy plan" informational brochure', () => {
    assert.ok(isHardRejected(
      'JAK POWSTAJE MIEJSCOWY PLAN ZAGOSPODAROWANIA PRZESTRZENNEGO W WARSZAWIE',
      'jak-powstaje-mpzp.pdf',
      'Informacja o procesie sporządzania planu',
    ))
  })
  it('rejects "jak czytać plan" guide', () => {
    assert.ok(isHardRejected('Jak czytać plan miejscowy — poradnik dla mieszkańców', '', ''))
  })
  it('does NOT reject adopted plan with mpzp in title', () => {
    // Legitimate document — title similar to brochure but not a brochure
    assert.ok(!isHardRejected(
      'Uchwała Nr XII/89/2022 w sprawie miejscowego planu zagospodarowania przestrzennego',
      'mpzp-uchwala.pdf',
      'Tekst planu miejscowego',
    ))
  })
})

// ── Ranking: adopted > draft > procedural ────────────────────────────────────

describe('ranking: adopted plan beats draft and brochure', () => {
  const bipTrust: TrustEntry = { domain: 'bip.warszawa.pl', trust: 'high', label: 'BIP Warszawa' }
  const ctx: LocationContext = { municipality: 'Warszawa' }

  it('adopted UCHWAŁA ranks above DRAFT_PLAN in classificationScore', () => {
    assert.ok(classificationScore('ADOPTED_PLAN_TEXT') < classificationScore('DRAFT_PLAN'))
  })

  it('adopted plan scores higher than draft in full scoreResult', () => {
    const adoptedResult = {
      title: 'Uchwała Nr LXXVII/2505/2023 MPZP Warszawa tekst planu',
      url:   'https://bip.warszawa.pl/uchwala-2505.pdf',
      description: 'Warszawa miejscowy plan',
    }
    const draftResult = {
      title: 'Projekt MPZP Warszawa — wyłożenie do publicznego wglądu',
      url:   'https://bip.warszawa.pl/projekt-mpzp.pdf',
      description: 'Warszawa projekt planu',
    }
    const { confidence: c1 } = scoreResult(adoptedResult, ctx, 'ADOPTED_PLAN_TEXT', bipTrust)
    const { confidence: c2 } = scoreResult(draftResult,  ctx, 'DRAFT_PLAN',         bipTrust)
    assert.ok(c1 > c2, `adopted (${c1}) should score above draft (${c2})`)
  })

  it('DRAFT_PLAN is not surfaceable so never reaches the UI', () => {
    assert.ok(!isSurfaceable('DRAFT_PLAN'))
  })
})

// ── MIN_CONFIDENCE_THRESHOLD sanity ──────────────────────────────────────────

describe('MIN_CONFIDENCE_THRESHOLD', () => {
  it('is between 30 and 70 (sanity check)', () => {
    assert.ok(MIN_CONFIDENCE_THRESHOLD >= 30 && MIN_CONFIDENCE_THRESHOLD <= 70)
  })
})
