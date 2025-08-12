import type { QueryResponse } from '../schema';

const now = () => new Date().toISOString();

export function demoFor(text: string): QueryResponse {
  const t = text.toLowerCase();
  if (t.includes('new york') || t.includes('nyc')) {
    return {
      answer: 'Yes — NYC tap water generally meets or exceeds federal/state standards. Use cold water and run the tap ~30 seconds if unused for hours. Older buildings may have lead; a certified lead‑removing filter is prudent for infants and pregnant people.',
      sources: [
        { title: 'NYC 2024 Water Quality Report', url: 'https://www.nyc.gov/site/dep/water/drinking-water-quality-reports.page', publisher: 'NYC DEP' },
        { title: 'Lead in Drinking Water Basics', url: 'https://www.epa.gov/ground-water-and-drinking-water/lead-drinking-water-basic-information', publisher: 'US EPA' },
      ],
      safety: { confidence: 'high', advisories: [], last_updated: now() },
      suggestions: ['How do I get a free lead test kit in NYC?', 'Are PFAS detected in my borough?'],
    };
  }
  if (t.includes('flint')) {
    return {
      answer: 'Caution. Flint has replaced many lead service lines and recent samples are often below action levels, but premise plumbing can still leach lead. Use a certified lead‑removing filter and follow city notices.',
      sources: [
        { title: 'City of Flint Water Quality Updates', url: 'https://www.cityofflint.com/updates/water/', publisher: 'City of Flint' },
        { title: 'Lead and Copper Rule', url: 'https://www.epa.gov/dwreginfo/lead-and-copper-rule', publisher: 'US EPA' },
      ],
      safety: { confidence: 'medium', advisories: [{ level: 'advisory', title: 'Use certified lead‑removing filter' }], last_updated: now() },
      suggestions: ['Where can I pick up replacement filter cartridges?'],
    };
  }
  if (t.includes('jackson')) {
    return {
      answer: 'Mixed. Jackson, MS has faced intermittent system issues and advisories. Check current notices. If none are active, properly treated water may be safe; consider a point‑of‑use filter and keep emergency water on hand.',
      sources: [
        { title: 'City of Jackson Water Updates', url: 'https://www.jacksonms.gov/', publisher: 'City of Jackson' },
        { title: 'CDC Boil Water Advisories', url: 'https://www.cdc.gov/healthywater/emergency/drinking/drinking-water-advisories.html', publisher: 'CDC' },
      ],
      safety: { confidence: 'low', advisories: [{ level: 'boil', title: 'Monitor boil‑water notices' }], last_updated: now() },
      suggestions: ['Is there a boil‑water notice today?'],
    };
  }
  return {
    answer: 'I couldn’t find specifics for that location in the demo. Try the nearest city/county and state.',
    sources: [{ title: 'Consumer Confidence Reports (CCR)', url: 'https://www.epa.gov/ccr', publisher: 'US EPA' }],
    safety: { confidence: 'unknown', advisories: [], last_updated: now() },
    suggestions: ['Where do I find my city’s CCR?', 'How to test my tap for lead?'],
  };
}
