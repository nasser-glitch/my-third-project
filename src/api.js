const CACHE_PREFIX = 'wc2026_';
const FREE_TIER_LIMIT = 9; // leave 1 request as buffer against the 10/min ceiling

// Sliding-window rate limiter: tracks timestamps of recent requests
const reqTimestamps = [];
let headerAvailable = FREE_TIER_LIMIT; // updated from X-Requests-Available-Minute
let headerResetAt = 0;                 // epoch ms when the minute resets (from X-RequestCounter-Reset)

function pruneWindow() {
  const cutoff = Date.now() - 60_000;
  while (reqTimestamps.length && reqTimestamps[0] < cutoff) reqTimestamps.shift();
}

async function waitForSlot() {
  pruneWindow();

  // Honour server-side header if available
  if (headerAvailable <= 1 && headerResetAt > Date.now()) {
    const delay = headerResetAt - Date.now() + 250;
    await new Promise(r => setTimeout(r, delay));
    headerAvailable = FREE_TIER_LIMIT;
    pruneWindow();
    return;
  }

  // Fallback: sliding window
  if (reqTimestamps.length >= FREE_TIER_LIMIT) {
    const delay = 60_000 - (Date.now() - reqTimestamps[0]) + 150;
    await new Promise(r => setTimeout(r, Math.max(delay, 0)));
    pruneWindow();
  }
}

function consumeRateLimitHeaders(res) {
  const available = res.headers.get('X-Requests-Available-Minute');
  const reset = res.headers.get('X-RequestCounter-Reset');
  if (available !== null) headerAvailable = parseInt(available, 10);
  if (reset !== null) headerResetAt = Date.now() + parseInt(reset, 10) * 1000;
}

// ── Cache helpers ──────────────────────────────────────────────
function cacheKey(path) { return CACHE_PREFIX + path; }

function readCache(path) {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return { fresh: null, stale: null };
    const { data, expires } = JSON.parse(raw);
    return { fresh: Date.now() < expires ? data : null, stale: data };
  } catch {
    return { fresh: null, stale: null };
  }
}

function writeCache(path, data, ttlMs) {
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify({
      data,
      expires: Date.now() + ttlMs,
    }));
  } catch {}
}

// ── Core fetch ─────────────────────────────────────────────────
async function apiFetch(path, ttlMs, retryCount = 0) {
  await waitForSlot();
  reqTimestamps.push(Date.now());

  const res = await fetch(`/.netlify/functions/football?path=${encodeURIComponent(path)}`);

  consumeRateLimitHeaders(res);

  if (res.status === 429) {
    if (retryCount >= 2) throw new Error('rate_limited');
    const retryAfter = parseInt(res.headers.get('Retry-After') || '61', 10);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return apiFetch(path, ttlMs, retryCount + 1);
  }

  if (!res.ok) throw new Error(`api_${res.status}`);

  const data = await res.json();
  writeCache(path, data, ttlMs);
  return data;
}

// ── Cached fetch: uses fresh cache if available, else calls API ─
async function cachedFetch(path, ttlMs) {
  const { fresh, stale } = readCache(path);
  if (fresh) return { data: fresh, fromCache: true };

  try {
    const data = await apiFetch(path, ttlMs);
    return { data, fromCache: false };
  } catch (err) {
    if (stale) return { data: stale, fromCache: true, stale: true, error: err.message };
    throw err;
  }
}

// ── Forced refresh: always calls API, falls back to stale cache ─
async function forceFetch(path, ttlMs) {
  const { stale } = readCache(path);
  try {
    const data = await apiFetch(path, ttlMs);
    return { data, fromCache: false };
  } catch (err) {
    if (stale) return { data: stale, fromCache: true, stale: true, error: err.message };
    throw err;
  }
}

// ── Public API ─────────────────────────────────────────────────

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Today's matches — short TTL, force-refresh during polling */
export async function fetchTodaysMatches(force = false) {
  const today = todayISO();
  const path = `/competitions/WC/matches?dateFrom=${today}&dateTo=${today}`;
  return force ? forceFetch(path, 60_000) : cachedFetch(path, 60_000);
}

/** Full tournament schedule — longer TTL */
export async function fetchAllMatches(force = false) {
  const path = `/competitions/WC/matches`;
  return force ? forceFetch(path, 5 * 60_000) : cachedFetch(path, 5 * 60_000);
}

/** Group standings */
export async function fetchStandings(force = false) {
  const path = `/competitions/WC/standings`;
  return force ? forceFetch(path, 5 * 60_000) : cachedFetch(path, 5 * 60_000);
}

/** Next upcoming match (for "no matches today" message) */
export async function fetchNextMatch() {
  const path = `/competitions/WC/matches?status=SCHEDULED&limit=1`;
  return cachedFetch(path, 10 * 60_000);
}
