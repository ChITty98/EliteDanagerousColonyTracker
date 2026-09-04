// server/ai/copilotNews.js
//
// GalNet news — Tycho's domain (see [[reference_tars_persona_spec]]). Fetches the OFFICIAL
// Frontier CMS GalNet feed (real articles only) and caches the latest, so a LIVE take can
// lead with the co-pilot's INTERPRETATION rather than re-reading the article. ANTI-INVENTION:
// if the feed is empty/unreachable, return null and the co-pilot says nothing — never fake a
// headline. The feed user-agent-gates plain fetchers (403), so we send a browser UA.
//
// Deferred follow-up: Community Goals (INARA API — needs the commander's key) and the
// distance-weighting mechanic (needs the item's system coords).

const GALNET_URL = 'https://cms.zaonce.net/en-GB/jsonapi/node/galnet_article?sort=-published_at&page%5Blimit%5D=5';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const REFRESH_MS = 30 * 60 * 1000;

let cache = null; // { title, snippet, publishedAt } | null
let cacheAt = 0;

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Fetch the latest GalNet articles; returns the most recent { title, snippet, publishedAt } or null. */
export async function fetchGalNet() {
  try {
    const res = await fetch(GALNET_URL, { headers: { 'User-Agent': UA, Accept: 'application/vnd.api+json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const arr = Array.isArray(json && json.data) ? json.data : [];
    const a = arr.map((d) => d && d.attributes).filter(Boolean)[0];
    if (!a || !a.title) return null;
    const item = { title: String(a.title), snippet: stripHtml(a.body && a.body.value).slice(0, 320), publishedAt: a.published_at || '' };
    cache = item; cacheAt = Date.now();
    return item;
  } catch { return null; }
}

/** The cached latest article if still fresh, else null (the organic beat uses this). */
export function getLatestNews(maxAgeMs = REFRESH_MS * 2) {
  return cache && Date.now() - cacheAt < maxAgeMs ? cache : null;
}

/** Keep the cache warm so the organic beat has something real to surface. Best-effort. */
export function startNewsRefresh() {
  fetchGalNet().catch(() => {});
  const t = setInterval(() => { fetchGalNet().catch(() => {}); }, REFRESH_MS);
  if (t && t.unref) t.unref();
}
