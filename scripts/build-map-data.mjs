// Builds the map data for RibolovMK.
//
// 1. Downloads from OpenStreetMap (Overpass API):
//      - the border of North Macedonia
//      - named rivers (waterway=river)
//      - named lakes and reservoirs (natural=water + water=lake|reservoir)
// 2. Merges river segments that have the same name AND touch each other,
//    so one click selects the whole river.
// 3. Gives every river and lake a readable, stable id (e.g. "vardar").
// 4. Clips everything to the border and simplifies it with mapshaper.
// 5. Writes ../data/map/{border,rivers,lakes}.geojson and ../data/map/report.md
//
// Usage (from this folder):
//   npm ci
//   npm run build                       download fresh data and build
//   node build-map-data.mjs --cached    rebuild from the last download (scripts/cache/)
//
// Normally this runs on GitHub (see .github/workflows/update-map-data.yml).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';
import mapshaper from 'mapshaper';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'cache');            // raw downloads (not committed)
const TMP_DIR = path.join(CACHE_DIR, 'tmp');           // intermediate files (not committed)
const OUT_DIR = path.join(HERE, '..', 'data', 'map');  // final files (committed)

// Overpass servers, tried in this order.
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const USER_AGENT = 'RibolovMK map data builder (https://github.com/IlKostadinovski/Ribolov.mk)';

// How much to simplify: remove details smaller than this many metres.
const SIMPLIFY_METRES = 20;
// Coordinate precision in degrees (0.00001° is about 1 metre).
const PRECISION = 0.00001;

// The country relation of North Macedonia.
const COUNTRY = 'relation["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="MK"]';

const QUERIES = {
  border: `
    [out:json][timeout:300];
    ${COUNTRY};
    out body; >; out skel qt;`,
  rivers: `
    [out:json][timeout:300];
    ${COUNTRY}; map_to_area->.mk;
    way["waterway"="river"]["name"](area.mk);
    out body; >; out skel qt;`,
  lakes: `
    [out:json][timeout:300];
    ${COUNTRY}; map_to_area->.mk;
    (
      way["natural"="water"]["water"~"^(lake|reservoir)$"]["name"](area.mk);
      relation["natural"="water"]["water"~"^(lake|reservoir)$"]["name"](area.mk);
    );
    out body; >; out skel qt;`,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const useCache = process.argv.includes('--cached');
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  // 1. Download (or read the last download)
  const raw = {};
  for (const name of Object.keys(QUERIES)) {
    const file = path.join(CACHE_DIR, `${name}.json`);
    if (useCache) {
      raw[name] = JSON.parse(await fs.readFile(file, 'utf8'));
    } else {
      raw[name] = await downloadOverpass(name, QUERIES[name]);
      await fs.writeFile(file, JSON.stringify(raw[name]));
    }
    console.log(`${name}: ${raw[name].elements.length} OSM elements`);
  }
  const osmDate = raw.rivers.osm3s?.timestamp_osm_base || 'unknown';

  // 2. Build features
  const border = buildBorder(raw.border);
  const rivers = buildRivers(raw.rivers);
  const lakes = buildLakes(raw.lakes);
  assignIds([...lakes, ...rivers]);

  await writeGeoJSON(path.join(TMP_DIR, 'border.geojson'), [border]);
  await writeGeoJSON(path.join(TMP_DIR, 'rivers.geojson'), rivers);
  await writeGeoJSON(path.join(TMP_DIR, 'lakes.geojson'), lakes);

  // 3. Clip to the border and simplify (all layers together, so the lake
  //    edges along the border stay exactly on the border line)
  await runMapshaper();

  // 4. Report
  const final = {
    rivers: await readFeatures(path.join(OUT_DIR, 'rivers.geojson')),
    lakes: await readFeatures(path.join(OUT_DIR, 'lakes.geojson')),
  };
  const report = makeReport({ osmDate, rivers, lakes, final });
  await fs.writeFile(path.join(OUT_DIR, 'report.md'), report);
  console.log('\n' + report);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function downloadOverpass(name, query) {
  const errors = [];
  for (let round = 1; round <= 3; round++) {
    for (const server of OVERPASS_SERVERS) {
      try {
        console.log(`Downloading ${name} from ${server} (try ${round})…`);
        const res = await fetch(server, {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(6 * 60 * 1000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // Overpass reports timeouts and memory errors in "remark", with HTTP 200.
        if (json.remark && /error/i.test(json.remark)) throw new Error(json.remark);
        if (!json.elements?.length) throw new Error('empty result');
        return json;
      } catch (err) {
        errors.push(`${server}: ${err.message}`);
        console.warn(`  failed: ${err.message}`);
      }
    }
    await sleep(30_000 * round); // be polite to the servers before retrying
  }
  throw new Error(`Could not download ${name}:\n` + errors.join('\n'));
}

// ---------------------------------------------------------------------------
// Border
// ---------------------------------------------------------------------------

function buildBorder(osm) {
  const feature = osmtogeojson(osm).features.find(
    (f) => f.properties.id?.startsWith('relation/') && isPolygon(f),
  );
  if (!feature) throw new Error('Border polygon not found in the download');
  return {
    type: 'Feature',
    properties: { id: 'border', name: macedonianName(feature.properties) },
    geometry: feature.geometry,
  };
}

// ---------------------------------------------------------------------------
// Rivers: merge segments with the same name that touch each other
// ---------------------------------------------------------------------------

function buildRivers(osm) {
  const coords = new Map(); // node id -> [lon, lat]
  for (const el of osm.elements) {
    if (el.type === 'node') coords.set(el.id, [el.lon, el.lat]);
  }

  // Group the river ways by Macedonian name.
  const byName = new Map();
  for (const el of osm.elements) {
    if (el.type !== 'way' || el.tags?.waterway !== 'river') continue;
    const name = macedonianName(el.tags);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(el);
  }

  // Within each name, join ways that share at least one node.
  const rivers = [];
  for (const [name, ways] of byName) {
    for (const group of connectedGroups(ways)) {
      const lines = group
        .map((way) => way.nodes.map((n) => coords.get(n)).filter(Boolean))
        .filter((line) => line.length >= 2);
      if (!lines.length) continue;
      rivers.push({
        type: 'Feature',
        properties: {
          id: null, // set later by assignIds()
          name,
          'name:en': mostCommon(group.map((w) => w.tags['name:en'])),
          type: 'river',
        },
        geometry: { type: 'MultiLineString', coordinates: lines },
        size: lines.reduce((sum, line) => sum + lineLength(line), 0), // metres
      });
    }
  }
  return rivers;
}

// Splits ways into groups of ways that are connected through shared nodes.
function connectedGroups(ways) {
  const parent = ways.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstWayWithNode = new Map();
  ways.forEach((way, i) => {
    for (const node of way.nodes) {
      if (firstWayWithNode.has(node)) parent[find(i)] = find(firstWayWithNode.get(node));
      else firstWayWithNode.set(node, i);
    }
  });
  const groups = new Map();
  ways.forEach((way, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(way);
  });
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Lakes and reservoirs
// ---------------------------------------------------------------------------

function buildLakes(osm) {
  const lakes = [];
  for (const f of osmtogeojson(osm).features) {
    const tags = f.properties;
    if (tags.natural !== 'water' || !['lake', 'reservoir'].includes(tags.water)) continue;
    if (!isPolygon(f)) continue;
    const name = macedonianName(tags);
    if (!name) continue;
    lakes.push({
      type: 'Feature',
      properties: {
        id: null, // set later by assignIds()
        name,
        'name:en': tags['name:en'] || null,
        type: tags.water, // "lake" or "reservoir"
      },
      geometry: f.geometry,
      size: polygonArea(f.geometry), // rough, only used for sorting
    });
  }
  return lakes;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

// Gives each feature an id made from its Macedonian name, e.g. "Охридско Езеро"
// becomes "ohridsko-ezero". If several waters share a name, the biggest one gets
// the plain id and the others get "-2", "-3", … (lakes before rivers).
function assignIds(features) {
  const byBase = new Map();
  for (const f of features) {
    const base = slugify(f.properties.name) || 'water';
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  for (const [base, group] of byBase) {
    group.sort((a, b) => typeRank(a) - typeRank(b) || b.size - a.size);
    group.forEach((f, i) => {
      f.properties.id = i === 0 ? base : `${base}-${i + 1}`;
    });
  }
}

const typeRank = (f) => (f.properties.type === 'river' ? 1 : 0);

// Macedonian Cyrillic -> Latin (official romanization), plus a few other letters.
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', џ: 'dzh',
  ш: 'sh', ђ: 'dj', ћ: 'c', й: 'j', ё: 'e', ъ: 'a', ь: '', ы: 'y', э: 'e', ю: 'ju', я: 'ja',
};

function slugify(text) {
  return [...text.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove accents (ë -> e, ç -> c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// mapshaper: clip + simplify
// ---------------------------------------------------------------------------

async function runMapshaper() {
  const tmp = (name) => `"${path.join(TMP_DIR, name)}"`;
  await mapshaper.runCommands([
    '-quiet',
    `-i ${tmp('border.geojson')} ${tmp('rivers.geojson')} ${tmp('lakes.geojson')} combine-files`,
    '-clip border target=rivers',
    '-clip border target=lakes remove-slivers',
    '-filter true remove-empty target=rivers,lakes',
    `-simplify interval=${SIMPLIFY_METRES} keep-shapes`,
    `-o "${OUT_DIR}/" format=geojson extension=geojson precision=${PRECISION} target=border,rivers,lakes`,
  ].join(' '));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function makeReport({ osmDate, rivers, lakes, final }) {
  const lines = [];
  lines.push('# Map data report', '');
  lines.push('Generated by `scripts/build-map-data.mjs`. Do not edit by hand.', '');
  lines.push(`- OpenStreetMap data as of: ${osmDate}`);
  lines.push(`- Rivers: ${final.rivers.length}`);
  lines.push(`- Lakes and reservoirs: ${final.lakes.length}`);
  lines.push('');

  const all = [...final.lakes, ...final.rivers].map((f) => f.properties);

  // Names used by more than one water body
  const dupes = groupBy(all, (p) => p.name);
  const dupeList = [...dupes].filter(([, list]) => list.length > 1);
  lines.push('## Names used more than once', '');
  if (!dupeList.length) lines.push('None.');
  else {
    lines.push('These are separate water bodies with the same name (or a river whose');
    lines.push('pieces do not touch in OpenStreetMap). Check that they really are different.', '');
    for (const [name, list] of dupeList) {
      lines.push(`- **${name}**: ${list.map((p) => `\`${p.id}\` (${p.type})`).join(', ')}`);
    }
  }
  lines.push('');

  // Removed while clipping (completely outside the country)
  const kept = new Set(all.map((p) => p.id));
  const removed = [...lakes, ...rivers].filter((f) => !kept.has(f.properties.id));
  if (removed.length) {
    lines.push('## Outside the border (not on the map)', '');
    lines.push(removed.map((f) => `\`${f.properties.id}\``).join(', '), '');
  }

  // Full list
  lines.push('## All waters', '');
  lines.push('Use the **id** to link fishing information in `data/waters.json`.', '');
  lines.push('| id | Name | English name | Type |', '|---|---|---|---|');
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sorted) {
    lines.push(`| \`${p.id}\` | ${p.name} | ${p['name:en'] || '—'} | ${p.type} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Prefer the explicit Macedonian name; fall back to the main name.
function macedonianName(tags) {
  return (tags['name:mk'] || tags.name || '').trim();
}

function isPolygon(f) {
  return f.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type);
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  for (const [v, n] of counts) if (!best || n > counts.get(best)) best = v;
  return best;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// Length of a line in metres.
function lineLength(line) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distance(line[i - 1], line[i]);
  return total;
}

function distance([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Rough area (only used to decide which of two same-named lakes is bigger).
function polygonArea(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const rings of polygons) {
    const outer = rings[0];
    for (let i = 1; i < outer.length; i++) {
      total += outer[i - 1][0] * outer[i][1] - outer[i][0] * outer[i - 1][1];
    }
  }
  return Math.abs(total / 2);
}

async function writeGeoJSON(file, features) {
  const clean = features.map(({ type, properties, geometry }) => ({ type, properties, geometry }));
  await fs.writeFile(file, JSON.stringify({ type: 'FeatureCollection', features: clean }));
}

async function readFeatures(file) {
  return JSON.parse(await fs.readFile(file, 'utf8')).features;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
