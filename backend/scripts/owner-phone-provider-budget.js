import fs from 'node:fs';
import path from 'node:path';
import { classifyGoogleErrorResponse } from './owner-google-error-classification.js';

// One process owns this durable ledger. Reservations are flushed BEFORE network IO.
// A crash leaves the lock in place: an operator must verify no server is alive.
export function createOwnerProviderBudget({ directory, fetchImpl = globalThis.fetch, limits = { google: 5, graphhopper: 10 }, diagnostic = () => {}, now = Date.now, dynamicResearch = false, acceptanceMode = false }) {
  if (acceptanceMode && (dynamicResearch || limits.google !== 1 || limits.graphhopper !== 2 || Object.keys(limits).length !== 2)) throw Error('private_budget_invalid');
  const groundingAllowed = dynamicResearch && Object.hasOwn(limits, "grounding");
  const maxima = dynamicResearch ? { google: 30, graphhopper: 10, osm: 8, wikidata: 30, commons: 10 } : { google: 5, graphhopper: 10 };
  if (groundingAllowed) maxima.grounding = 3;
  const providers = Object.keys(maxima);
  if (Object.keys(limits).sort().join(',') !== providers.sort().join(',') ||
      providers.some(key => !Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > maxima[key])) throw Error('private_budget_invalid');
  limits = Object.fromEntries(providers.map(key => [key, limits[key]]));
  const version = acceptanceMode ? 4 : groundingAllowed ? 3 : dynamicResearch ? 2 : 1;
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() ||
      (info.mode & 0o777) !== 0o700 || fs.realpathSync(directory) !== directory) throw Error('private_budget_invalid');
  const ledgerPath = path.join(directory, 'provider-budget.json');
  const lockPath = path.join(directory, 'provider-budget.lock');
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  let closed = false;
  let state;
  function persist() {
    const temporary = ledgerPath + '.next';
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, ledgerPath);
    const dir = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
  try {
    if (fs.existsSync(ledgerPath)) {
      const fd = fs.openSync(ledgerPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 2048) throw Error();
        state = JSON.parse(fs.readFileSync(fd, 'utf8'));
      } finally { fs.closeSync(fd); }
      if (state.version !== version || providers.some(key => !Number.isInteger(state[key]) || state[key] < 0 || state[key] > limits[key]) ||
          !Number.isInteger(state.rateLimits) || state.rateLimits < 0 || typeof state.stopped !== 'boolean') throw Error();
      const storedLimits = state.limits ?? { google: 5, graphhopper: 10 };
      if (Object.keys(storedLimits).sort().join(',') !== providers.sort().join(',') || providers.some(key => storedLimits[key] !== limits[key])) throw Error();
    } else { state = { version, limits, ...Object.fromEntries(providers.map(key => [key, 0])), rateLimits: 0, stopped: false }; persist(); }
  } catch { fs.closeSync(lock); fs.unlinkSync(lockPath); throw Error('private_budget_invalid'); }
  return {
    remaining() { return { ...Object.fromEntries(providers.map(key => [key, limits[key] - state[key]])), stopped: state.stopped }; },
    close() { if (!closed) { closed = true; fs.closeSync(lock); fs.unlinkSync(lockPath); } },
    async fetch(url, init) {
      const target = new URL(url);
      const provider = target.origin === 'https://generativelanguage.googleapis.com' && target.pathname === '/v1beta/interactions' ? 'google' :
        target.origin === 'https://graphhopper.com' && target.pathname === '/api/1/route' ? 'graphhopper' :
        dynamicResearch && target.origin === 'https://overpass-api.de' && target.pathname === '/api/interpreter' ? 'osm' :
        dynamicResearch && target.origin === 'https://www.wikidata.org' && /^\/wiki\/Special:EntityData\/Q[1-9][0-9]*\.json$/.test(target.pathname) ? 'wikidata' :
        dynamicResearch && target.origin === 'https://commons.wikimedia.org' && target.pathname === '/w/api.php' &&
          target.searchParams.get('action') === 'query' && target.searchParams.get('prop') === 'imageinfo' ? 'commons' : null;
      if (!provider || target.username || target.password || target.hash || closed || state.stopped || init?.signal?.aborted ||
          (['wikidata', 'commons'].includes(provider) ? (init?.method ?? 'GET') !== 'GET' : init?.method !== 'POST')) throw Error('private_provider_blocked');
      if (acceptanceMode) {
        // Narrow owner acceptance contract; no tools, prior sessions, media, priority tier,
        // optimization or large waypoint jobs. Public pricing must be re-reviewed in 2027.
        if (now() >= Date.UTC(2027, 0, 1) || typeof init.body !== 'string' || Buffer.byteLength(init.body) > 65536) throw Error('private_acceptance_blocked');
        const body = JSON.parse(init.body);
        if ([...target.searchParams.keys()].some(key => provider !== 'graphhopper' || key !== 'key')) throw Error('private_acceptance_blocked');
        if (provider === 'google' && (
          Object.keys(body).some(key => !['model','input','response_format','store'].includes(key)) ||
          typeof body.input !== 'string' || body.response_format?.mime_type !== 'application/json'
        )) throw Error('private_acceptance_blocked');
        if (provider === 'graphhopper' && (
          !Array.isArray(body.points) || body.points.length < 1 || body.points.length > 10 ||
          Object.hasOwn(body, 'optimize') ||
          (body.algorithm !== undefined && !['alternative_route','round_trip'].includes(body.algorithm))
        )) throw Error('private_acceptance_blocked');
      }
      let groundedRequest = false;
      if (provider === 'google') {
        const body = JSON.parse(init.body);
        if (Array.isArray(body.tools)) {
          groundedRequest = body.tools.some(tool => ['google_search','url_context'].includes(tool?.type));
          if (body.tools.some(tool => !['function','google_search','url_context'].includes(tool?.type)) ||
              (groundedRequest && !groundingAllowed)) throw Error('private_grounding_not_authorized');
        }
        if (body.model !== 'gemini-3.8-flash') throw Error('private_model_invalid');
        body.store = false;
        init = { ...init, body: JSON.stringify(body) };
      }
      if (groundedRequest && state.grounding >= limits.grounding) throw Error('private_budget_exhausted');
      if (state[provider] >= limits[provider]) throw Error('private_budget_exhausted');
      state[provider]++;
      if (groundedRequest) state.grounding++;
      try { persist(); } catch { state.stopped = true; throw Error('private_budget_unavailable'); }
      let response;
      const startedAt = now();
      const report = outcome => {
        try { diagnostic({ event: 'provider_completed', ...outcome, groundingEnabled: groundedRequest, durationMs: now() - startedAt }); } catch {}
      };
      try { response = await fetchImpl(url, { ...init, redirect: 'manual' }); }
      catch (error) {
        const safeCodes = ['ENOTFOUND','ECONNRESET','ETIMEDOUT','UND_ERR_SOCKET','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
        const signalAborted = init?.signal?.aborted === true;
        const code = error?.cause?.code ?? error?.code;
        state.lastOutcome = { provider, kind: signalAborted || error?.name === 'AbortError' ? 'aborted' : 'transport_error',
          code: safeCodes.includes(code) ? code : 'unclassified', signalAborted };
        try { persist(); } catch { state.stopped = true; }
        report(state.lastOutcome);
        throw Error('private_provider_unavailable');
      }
      const outcome = { provider, kind: 'http', status: response.status };
      state.lastOutcome = outcome;
      if ([401, 402, 403].includes(response.status)) state.stopped = true;
      if (response.status === 429 && ++state.rateLimits >= 2) state.stopped = true;
      try { persist(); } catch { state.stopped = true; throw Error('private_budget_unavailable'); }
      // Persist admission/HTTP accounting before bounded, best-effort diagnostics.
      const errorMetadata = provider === 'google' && response.status >= 400
        ? await classifyGoogleErrorResponse(response, {signal: init?.signal}) : {};
      report({...outcome, ...errorMetadata});
      return response;
    }
  };
}
