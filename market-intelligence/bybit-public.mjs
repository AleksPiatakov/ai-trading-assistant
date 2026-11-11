/**
 * Small read-only client for Bybit public market data.
 * It deliberately contains no authentication or order functionality.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const retryAfterMs = response => {
  const raw = response?.headers?.get?.('retry-after');
  // Number(null) is 0, which would accidentally turn a missing header into a
  // zero-delay retry and make rate limiting worse.
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
};

export function createBybitPublicClient({
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
  baseUrl = 'https://api.bybit.com',
  maxAttempts = 4,
  baseDelayMs = 300
} = {}) {
  async function call(endpoint, params = {}) {
    const url = new URL(endpoint, baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(14_000), cache: 'no-store' });
        if (!response.ok) {
          const error = new Error(response.status === 429 ? 'Bybit rate limit (HTTP 429)' : `Bybit HTTP ${response.status}`);
          error.retryable = RETRYABLE_STATUS.has(response.status);
          error.retryAfterMs = retryAfterMs(response);
          throw error;
        }
        const payload = await response.json();
        if (payload?.retCode !== 0) {
          const error = new Error(`Bybit: ${String(payload?.retMsg || payload?.retCode).slice(0, 110)}`);
          error.retryable = Number(payload?.retCode) === 10006;
          throw error;
        }
        return payload.result || {};
      } catch (error) {
        lastError = error;
        if (!error?.retryable || attempt === maxAttempts - 1) break;
        const exponential = baseDelayMs * 2 ** attempt;
        const delay = error.retryAfterMs ?? exponential;
        await sleep(Math.min(delay, 10_000));
      }
    }
    const detail = String(lastError?.message || 'невідома помилка').slice(0, 140);
    const diagnostic = new Error(`${detail}; attempts=${maxAttempts}; at=${new Date(now()).toISOString()}`);
    diagnostic.cause = lastError;
    diagnostic.attempts = maxAttempts;
    diagnostic.endpoint = endpoint;
    throw diagnostic;
  }
  return { call };
}
