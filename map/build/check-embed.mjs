// Which play links refuse to be shown in a frame, for the map's play-in-place.
//
//   node map/build/check-embed.mjs
//
// Reads every play link in map/data/cities.json, asks each site for its
// headers (following redirects), and writes map/data/no-embed.json: the links
// whose X-Frame-Options or CSP frame-ancestors keep another site from framing
// them. The map opens those in a new tab. A link the check can't reach is left
// out, so it is tried in a frame. Run it after adding cities; it needs network.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '..', 'data');
const { places } = JSON.parse(readFileSync(join(data, 'cities.json'), 'utf8'));
const urls = [...new Set(places.flatMap((p) => [...p.entries, ...(p.remixes || [])]).map((e) => e.links.play).filter(Boolean))].sort();

function refuses(h) {
  const xfo = (h.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return `X-Frame-Options: ${xfo}`;
  const fa = (h.get('content-security-policy') || '').split(';').map((s) => s.trim()).find((s) => s.toLowerCase().startsWith('frame-ancestors'));
  if (fa && !/\*|https:\s*$|https:\s/.test(fa.slice(15))) return `CSP ${fa}`;
  return null;
}

const out = [], unreached = [];
await Promise.all(urls.map(async (u) => {
  try {
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'slop-cities-embed-check' } });
    r.body?.cancel();
    const why = refuses(r.headers);
    if (why) out.push({ url: u, why });
  } catch (e) { unreached.push(u); }
}));
out.sort((a, b) => a.url.localeCompare(b.url));
writeFileSync(join(data, 'no-embed.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${urls.length} play links, ${out.length} refuse a frame${unreached.length ? `, ${unreached.length} not reached: ${unreached.join(' ')}` : ''}. Wrote map/data/no-embed.json.`);
