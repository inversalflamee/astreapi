const axios = require('axios');

// ── Utility: random jitter (0 to maxMs ms) ─────────
function jitter(maxMs = 2000) {
  return Math.random() * maxMs;
}

// ── Utility: retry a function with exponential backoff
async function withRetry(fn, retries = 2, baseDelay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      const delay = baseDelay * Math.pow(2, i) + Math.random() * 500;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ══════════════════════════════════════════════════════
//  Real Provider 1 – Public HLS Test Stream
//  (Big Buck Bunny – open source, legal to use)
// ══════════════════════════════════════════════════════
async function publicHLSProvider({ type, tmdbId, season, episode }) {
  await new Promise(r => setTimeout(r, jitter(300))); // minimal delay

  // This provider returns the same stream for any movie/TV request.
  // For a real service, you'd map tmdbId to actual video URLs.
  return {
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', // Big Buck Bunny HLS
    label: 'Public HLS (Demo)'
  };
}

// ══════════════════════════════════════════════════════
//  Example Provider 2 (fake) – keep as fallback
// ══════════════════════════════════════════════════════
async function providerA({ type, tmdbId, season, episode }) {
  await new Promise(r => setTimeout(r, jitter(800)));
  if (type === 'movie' && tmdbId === 550) {
    return {
      url: 'https://example.com/stream/fightclub.m3u8',
      label: 'Provider A (fake)'
    };
  }
  return null;
}

// ── List of active providers ────────────────────────
const providers = [publicHLSProvider, providerA];  // real provider first

// ══════════════════════════════════════════════════════
//  Provider Runner (retry, verify, emit)
// ══════════════════════════════════════════════════════
async function resolveProvider(providerFn, params) {
  const label = providerFn.name || 'unknown';
  try {
    const result = await withRetry(() => providerFn(params), 2, 800);
    if (!result || !result.url) return null;

    // 🔧 Verification disabled for fake URLs – safe for public demo
    //    To re-enable, uncomment the block below.
    // try {
    //   await axios.head(result.url, { timeout: 5000 });
    //   return result;
    // } catch {
    //   console.warn(`${label} failed URL verification`);
    //   return null;
    // }
    return result;
  } catch (err) {
    console.warn(`${label} failed after retries: ${err.message}`);
    return null;
  }
}

module.exports = { providers, resolveProvider };
