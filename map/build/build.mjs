// cities.yml -> the lists in README.md and map/data/cities.json.
//
//   node map/build/build.mjs           write both
//   node map/build/build.mjs --check   change nothing; exit 1 if either is out of date
//
// cities.yml is the only place an entry is written by hand. The README keeps
// its hand-written parts (intro, Featured, Contributing); the build replaces
// only what sits between its <!-- cities.yml ... --> markers. No npm install:
// the YAML parser is vendored.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './vendor/js-yaml.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const check = process.argv.includes('--check');
const ymlPath = join(root, 'cities.yml');
const readmePath = join(root, 'README.md');
const jsonPath = join(here, '..', 'data', 'cities.json');

const data = load(readFileSync(ymlPath, 'utf8'));

// ---------- checks: say which entry and which field is wrong ----------
const problems = [];
const where = (s) => (msg) => problems.push(`${s}: ${msg}`);
const LINKS = ['play', 'source', 'tweet'];
const TAKE_KEYS = new Set(['tag', 'pick', ...LINKS, 'by', 'by_url', 'desc', 'flags', 'screenshot']);
const ENTRY_KEYS = new Set(['name', 'pick', ...LINKS, 'by', 'by_url', 'desc', 'flags', 'screenshot', 'card']);
const CITY_KEYS = new Set(['city', 'country', 'region', 'coords', 'remix_of', 'takes']);
function checkLinks(e, bad) {
  for (const k of [...LINKS, 'by_url']) if (e[k] != null && !/^https?:\/\/\S+$/.test(e[k])) bad(`${k} should be a full http(s) URL, not ${JSON.stringify(e[k])}`);
  if (!LINKS.some((k) => e[k])) bad('needs at least one of play, source or tweet');
  if (e.flags != null && !(Array.isArray(e.flags) && e.flags.every((f) => typeof f === 'string' && f && !f.includes(',')))) bad('flags should be a list like [source only, isometric]');
  if (e.screenshot != null && !existsSync(join(root, e.screenshot))) bad(`screenshot ${e.screenshot} does not exist`);
  if (e.desc != null && typeof e.desc !== 'string') bad('desc should be text');
  if (e.pick != null && typeof e.pick !== 'boolean') bad('pick should be true (or left out)');
}
function checkCity(c, label) {
  const bad = where(label);
  for (const k of Object.keys(c)) if (!CITY_KEYS.has(k)) bad(`unknown field "${k}"`);
  if (typeof c.city !== 'string' || !c.city) bad('needs city');
  const ll = c.coords;
  if (!(Array.isArray(ll) && ll.length === 2 && Math.abs(ll[0]) <= 90 && Math.abs(ll[1]) <= 180)) bad('coords should be [lat, lon], e.g. [52.2297, 21.0122]');
  if (!Array.isArray(c.takes) || !c.takes.length) bad('needs at least one take');
  for (const [i, t] of (c.takes || []).entries()) {
    const tb = where(`${label}, take ${i + 1}${t.tag ? ` (${t.tag})` : ''}`);
    for (const k of Object.keys(t)) if (!TAKE_KEYS.has(k)) tb(`unknown field "${k}"`);
    checkLinks(t, tb);
  }
}
if (!data.original) problems.push('cities.yml: missing original');
else checkCity(data.original, 'original');
const regions = data.cities?.regions || {};
for (const [r, list] of Object.entries(regions)) for (const c of list || []) checkCity(c, `${r} / ${c.city}`);
for (const [s, sec] of [['remixes', data.remixes], ['other', data.other]]) for (const [i, e] of (sec?.entries || []).entries()) {
  const bad = where(`${s} / ${e.name || `entry ${i + 1}`}`);
  for (const k of Object.keys(e)) if (!ENTRY_KEYS.has(k)) bad(`unknown field "${k}"`);
  if (!e.name) bad('needs name');
  checkLinks(e, bad);
}

// ---------- README ----------
const authorUrl = (e) => e.by_url || (e.by.startsWith('@') ? `https://x.com/${e.by.slice(1)}` : `https://github.com/${e.by}`);
function line(title, e) {
  const links = [['Play', e.play], ['Source', e.source], ['Tweet', e.tweet]].filter(([, u]) => u).map(([t, u]) => `[${t}](${u})`);
  let s = `- **${title}**`;
  if (links.length) s += ' - ' + links.join(' · ');
  if (e.by) s += ` - by [${e.by}](${authorUrl(e)}).`;
  else if (links.length) s += '.';
  if (e.desc) s += ' ' + e.desc.trim();
  if (e.flags?.length) s += ` *(${e.flags.join(', ')})*`;
  return s;
}
const takeTitle = (c, t) => `${c.city}${c.country ? ', ' + c.country : ''}${t.tag ? ` (${t.tag})` : ''}`;
const byCity = (a, b) => a.city.localeCompare(b.city, 'en', { sensitivity: 'base' });
const sorted = Object.fromEntries(Object.entries(regions).map(([r, list]) => [r, [...list].sort(byCity)]));
const anchor = (h) => '#' + h.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

function lists() {
  const out = ['## The original', '', ...data.original.takes.map((t) => line(takeTitle(data.original, t), t)), '', '## Cities', ''];
  if (data.cities.intro) out.push(data.cities.intro.trim(), '');
  for (const [r, list] of Object.entries(sorted)) out.push(`### ${r}`, '', ...list.flatMap((c) => c.takes.map((t) => line(takeTitle(c, t), t))), '');
  out.push('## New York remixes', '');
  if (data.remixes.intro) out.push(data.remixes.intro.trim(), '');
  out.push(...data.remixes.entries.map((e) => line(e.name, e)), '', '## Other maps, games and racing', '');
  if (data.other.intro) out.push(data.other.intro.trim(), '');
  out.push(...data.other.entries.map((e) => line(e.name, e)));
  return out.join('\n');
}
function contents() {
  const h = (t, d = 1) => `${'  '.repeat(d)}- [${t}](${anchor(t)})`;
  return [
    `- [Awesome Slop Cities](${anchor('Awesome Slop Cities')})`,
    h('Featured'), h('Contents'), h('The original'), h('Cities'),
    ...Object.keys(sorted).map((r) => h(r, 2)),
    h('New York remixes'), h('Other maps, games and racing'), h('Contributing'),
  ].join('\n');
}
const NOTE = 'generated from cities.yml by map/build/build.mjs: edit cities.yml, not this list';
function replaceBlock(text, id, body) {
  const start = `<!-- cities.yml:${id} (${NOTE}) -->`, end = `<!-- /cities.yml:${id} -->`;
  const re = new RegExp(`<!-- cities\\.yml:${id}\\b[^>]*-->[\\s\\S]*?<!-- /cities\\.yml:${id} -->`);
  if (!re.test(text)) throw new Error(`README.md has no <!-- cities.yml:${id} --> ... <!-- /cities.yml:${id} --> block`);
  return text.replace(re, () => `${start}\n\n${body}\n\n${end}`);
}

// ---------- map/data/cities.json ----------
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// The map shows descriptions as plain text.
const plainText = (s) => (s || '').trim().replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/`([^`]+)`/g, '$1');
const mapEntry = (title, e) => ({
  title,
  links: Object.fromEntries(LINKS.filter((k) => e[k]).map((k) => [k, e[k]])),
  author: e.by || null,
  authorUrl: e.by ? authorUrl(e) : null,
  desc: plainText(e.desc),
  flags: e.flags || [],
  screenshot: e.screenshot || null,
  pick: !!e.pick,
});
function places() {
  const all = [[data.original, data.original.region || 'North America', true], ...Object.entries(sorted).flatMap(([r, list]) => list.map((c) => [c, r, false]))];
  const out = all.map(([c, region, original]) => ({
    id: slug(c.city), city: c.city, country: c.country || null, region,
    lat: c.coords[0], lon: c.coords[1], original,
    entries: c.takes.map((t) => ({ ...mapEntry(takeTitle(c, t), t), tag: t.tag || null })),
    remixes: [],
    // Lineage arcs: from New York, unless every take runs on its own engine,
    // plus any city named in remix_of.
    parents: original ? [] : [...(c.takes.every((t) => (t.flags || []).includes('own engine')) ? [] : ['new-york']), ...(c.remix_of || [])],
  }));
  const ids = new Set(out.map((p) => p.id));
  for (const [i, p] of out.entries()) {
    if (out.findIndex((q) => q.id === p.id) !== i) problems.push(`${p.city}: listed twice; give the second one as another take of the first`);
    for (const id of p.parents) if (!ids.has(id)) problems.push(`${p.city}: remix_of names "${id}", which no city has (ids are lowercase, like kahramanmaras)`);
  }
  const ny = out.find((p) => p.original);
  ny.remixes = [...data.remixes.entries.map((e) => mapEntry(e.name, e)), ...data.other.entries.filter((e) => e.card === ny.id).map((e) => mapEntry(e.name, e))];
  for (const e of data.other.entries) if (e.card && !ids.has(e.card)) problems.push(`other / ${e.name}: card "${e.card}" names no city`);
  return out;
}

if (problems.length) { console.error(`cities.yml has ${problems.length} problem(s):\n  ` + problems.join('\n  ')); process.exit(1); }
const placesOut = places();
if (problems.length) { console.error(`cities.yml has ${problems.length} problem(s):\n  ` + problems.join('\n  ')); process.exit(1); }

const readmeOld = readFileSync(readmePath, 'utf8');
const readmeNew = replaceBlock(replaceBlock(readmeOld, 'contents', contents()), 'lists', lists());
const jsonNew = JSON.stringify({ places: placesOut }, null, 1) + '\n';
const jsonOld = existsSync(jsonPath) ? readFileSync(jsonPath, 'utf8') : '';
const stale = [readmeNew !== readmeOld && 'README.md', jsonNew !== jsonOld && 'map/data/cities.json'].filter(Boolean);
const takes = placesOut.reduce((n, p) => n + p.entries.length, 0);
// Every take, remix and other entry should have its own screenshot. A missing one
// doesn't fail the build; it's listed so it isn't forgotten.
const noShot = [
  ...placesOut.flatMap((p) => p.entries.filter((e) => !e.screenshot).map((e) => `${p.city}${e.tag ? ` (${e.tag})` : ''}`)),
  ...(data.remixes?.entries || []).filter((e) => !e.screenshot).map((e) => `remix: ${e.name}`),
  ...(data.other?.entries || []).filter((e) => !e.screenshot).map((e) => `other: ${e.name}`),
];
if (noShot.length) console.warn(`${noShot.length} without a screenshot: ${noShot.join('; ')}`);
if (check) {
  if (stale.length) { console.error(`Out of date: ${stale.join(', ')}. Run node map/build/build.mjs`); process.exit(1); }
  console.log('README.md and map/data/cities.json are up to date.');
} else {
  if (readmeNew !== readmeOld) writeFileSync(readmePath, readmeNew);
  if (jsonNew !== jsonOld) writeFileSync(jsonPath, jsonNew);
  console.log(`${placesOut.length} cities, ${takes} takes, ${placesOut.find((p) => p.original).remixes.length} New York remixes. ${stale.length ? 'Updated ' + stale.join(' and ') : 'Nothing changed'}.`);
}
