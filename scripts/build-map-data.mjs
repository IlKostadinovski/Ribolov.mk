// Builds the map data for RibolovMK.
//
// 1. Downloads from OpenStreetMap (Overpass API):
//      - the border of North Macedonia
//      - named rivers (waterway=river)
//      - named lakes and reservoirs (natural=water + water=lake|reservoir)
//      - cities and towns (place=city|town)
//      - municipality borders (admin_level=7)
// 2. Merges river segments that have the same name AND touch each other,
//    so one click selects the whole river.
// 3. Gives every river and lake a readable, stable id (e.g. "vardar").
// 4. Clips everything to the border and simplifies it with mapshaper.
// 5. Writes ../data/map/{border,rivers,lakes,municipalities,cities}.geojson
//    and ../data/map/report.md
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

// River pieces with the same name are joined if they touch, or if the gap
// between them is at most this many metres (OpenStreetMap often has small gaps,
// e.g. where a river passes a dam or crosses the border and back).
const JOIN_GAP_METRES = 7000;

// How much to simplify: remove details smaller than this many metres.
const SIMPLIFY_METRES = 20;
// Coordinate precision in degrees (0.00001° is about 1 metre).
const PRECISION = 0.00001;

// In OpenStreetMap, the municipalities (општини) of North Macedonia use this admin_level.
const MUNICIPALITY_LEVEL = '7';

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
  cities: `
    [out:json][timeout:120];
    ${COUNTRY}; map_to_area->.mk;
    node["place"~"^(city|town)$"]["name"](area.mk);
    out body;`,
  municipalities: `
    [out:json][timeout:300];
    ${COUNTRY}; map_to_area->.mk;
    relation["boundary"="administrative"]["admin_level"="${MUNICIPALITY_LEVEL}"](area.mk);
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
  const { rivers, joins } = buildRivers(raw.rivers);
  const lakes = buildLakes(raw.lakes);
  assignIds([...lakes, ...rivers]);
  const cities = buildCities(raw.cities);
  const municipalities = buildMunicipalities(raw.municipalities);

  await writeGeoJSON(path.join(TMP_DIR, 'border.geojson'), [border]);
  await writeGeoJSON(path.join(TMP_DIR, 'rivers.geojson'), rivers);
  await writeGeoJSON(path.join(TMP_DIR, 'lakes.geojson'), lakes);
  await writeGeoJSON(path.join(TMP_DIR, 'cities.geojson'), cities);
  await writeGeoJSON(path.join(TMP_DIR, 'municipalities.geojson'), municipalities);

  // 3. Clip to the border and simplify (all layers together, so the lake
  //    edges along the border stay exactly on the border line)
  await runMapshaper();

  // 4. Report
  const final = {
    rivers: await readFeatures(path.join(OUT_DIR, 'rivers.geojson')),
    lakes: await readFeatures(path.join(OUT_DIR, 'lakes.geojson')),
    cities: await readFeatures(path.join(OUT_DIR, 'cities.geojson')),
    municipalities: await readFeatures(path.join(TMP_DIR, 'municipality-areas.geojson')),
  };
  // North Macedonia has 80 municipalities (+ the City of Skopje). If far fewer are
  // found, OpenStreetMap probably uses another admin_level for them.
  if (final.municipalities.length < 60 || final.municipalities.length > 100) {
    throw new Error(`Expected about 80 municipalities at admin_level=${MUNICIPALITY_LEVEL}, `
      + `found ${final.municipalities.length}.`);
  }
  const report = makeReport({ osmDate, rivers, lakes, final, joins });
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

  const rivers = [];
  const joins = []; // pieces joined across a gap, listed in the report
  for (const [name, ways] of byName) {
    // 1. Ways that share a node form one piece.
    const pieces = connectedGroups(ways)
      .map((group) => makePiece(group, coords))
      .filter((piece) => piece.lines.length);
    // 2. Pieces with only a small gap between them form one river.
    for (const { members, gaps } of joinNearbyPieces(pieces)) {
      if (gaps.length) joins.push({ name, pieces: members.length, gaps });
      const lines = members.flatMap((p) => p.lines);
      rivers.push({
        type: 'Feature',
        properties: {
          id: null, // set later by assignIds()
          name,
          'name:en': mostCommon(members.flatMap((p) => p.ways).map((w) => w.tags['name:en'])),
          type: 'river',
        },
        geometry: { type: 'MultiLineString', coordinates: lines },
        size: lines.reduce((sum, line) => sum + lineLength(line), 0), // metres
      });
    }
  }
  return { rivers, joins };
}

// A piece = some connected ways, with their coordinates, end points and bounding box.
function makePiece(ways, coords) {
  const lines = ways
    .map((way) => way.nodes.map((n) => coords.get(n)).filter(Boolean))
    .filter((line) => line.length >= 2);
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of lines.flat()) {
    bbox[0] = Math.min(bbox[0], lon); bbox[1] = Math.min(bbox[1], lat);
    bbox[2] = Math.max(bbox[2], lon); bbox[3] = Math.max(bbox[3], lat);
  }
  return {
    ways,
    lines,
    ends: lines.flatMap((line) => [line[0], line[line.length - 1]]),
    bbox,
  };
}

// Groups pieces whose gap is at most JOIN_GAP_METRES. Returns
// [{ members: [piece, …], gaps: [metres, …] }, …].
function joinNearbyPieces(pieces) {
  const parent = pieces.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const gapsByRoot = new Map();
  const usedGaps = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (find(i) === find(j)) continue;
      const gap = pieceGap(pieces[i], pieces[j]);
      if (gap <= JOIN_GAP_METRES) {
        parent[find(j)] = find(i);
        usedGaps.push({ i, gap });
      }
    }
  }
  for (const { i, gap } of usedGaps) {
    const root = find(i);
    if (!gapsByRoot.has(root)) gapsByRoot.set(root, []);
    gapsByRoot.get(root).push(Math.round(gap));
  }
  const groups = new Map();
  pieces.forEach((piece, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, { members: [], gaps: gapsByRoot.get(root) || [] });
    groups.get(root).members.push(piece);
  });
  return [...groups.values()];
}

// Shortest distance (metres) from an end of one piece to any point of the other.
function pieceGap(a, b) {
  if (bboxDistance(a.bbox, b.bbox) > JOIN_GAP_METRES) return Infinity;
  let best = Infinity;
  for (const [ends, other] of [[a.ends, b.lines], [b.ends, a.lines]]) {
    for (const end of ends) {
      for (const line of other) {
        for (const point of line) best = Math.min(best, distance(end, point));
      }
    }
  }
  return best;
}

// Approximate distance (metres) between two bounding boxes; 0 if they overlap.
function bboxDistance(a, b) {
  const dLon = Math.max(0, a[0] - b[2], b[0] - a[2]);
  const dLat = Math.max(0, a[1] - b[3], b[1] - a[3]);
  const lat = ((a[1] + a[3]) / 2) * (Math.PI / 180);
  return Math.hypot(dLon * 111320 * Math.cos(lat), dLat * 110540);
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
// Cities and towns
// ---------------------------------------------------------------------------

function buildCities(osm) {
  return osm.elements
    .filter((el) => el.type === 'node' && macedonianName(el.tags || {}))
    .map((el) => ({
      type: 'Feature',
      properties: {
        id: slugify(macedonianName(el.tags)),
        name: macedonianName(el.tags),
        'name:en': el.tags['name:en'] || null,
        place: el.tags.place, // "city" or "town"
        population: parseInt(String(el.tags.population || '').replace(/\D/g, ''), 10) || null,
      },
      geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
    }))
    // Biggest first, so the map can give them label priority.
    .sort((a, b) => placeRank(a) - placeRank(b)
      || (b.properties.population || 0) - (a.properties.population || 0));
}

const placeRank = (f) => (f.properties.place === 'city' ? 0 : 1);

// ---------------------------------------------------------------------------
// Municipalities (only their borders end up on the map)
// ---------------------------------------------------------------------------

function buildMunicipalities(osm) {
  return osmtogeojson(osm).features
    .filter((f) => f.properties.id?.startsWith('relation/') && isPolygon(f)
      && f.properties.admin_level === MUNICIPALITY_LEVEL)
    .map((f) => ({
      type: 'Feature',
      properties: { name: macedonianName(f.properties) },
      geometry: f.geometry,
    }));
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
    .replace(/[\u0300-\u036f]/g, '') // remove accents (ë -> e, ç -> c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// mapshaper: clip + simplify
// ---------------------------------------------------------------------------

async function runMapshaper() {
  const tmp = (name) => `"${path.join(TMP_DIR, name)}"`;
  const layers = ['border', 'rivers', 'lakes', 'municipalities', 'cities'];
  await mapshaper.runCommands([
    '-quiet',
    `-i ${layers.map((name) => tmp(`${name}.geojson`)).join(' ')} combine-files`,
    '-clip border target=rivers',
    '-clip border target=lakes remove-slivers',
    '-clip border target=municipalities remove-slivers',
    '-clip border target=cities',
    '-filter true remove-empty target=rivers,lakes,municipalities,cities',
    `-simplify interval=${SIMPLIFY_METRES} keep-shapes`,
    // Keep the municipality areas (for the report), then turn them into the lines
    // between neighbouring municipalities (the outer edge is the country border).
    `-o ${tmp('municipality-areas.geojson')} format=geojson target=municipalities`,
    '-innerlines target=municipalities name=municipalities',
    `-o "${OUT_DIR}/" format=geojson geojson-type=FeatureCollection extension=geojson precision=${PRECISION} target=${layers.join(',')}`,
  ].join(' '));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function makeReport({ osmDate, rivers, lakes, final, joins }) {
  const lines = [];
  lines.push('# Map data report', '');
  lines.push('Generated by `scripts/build-map-data.mjs`. Do not edit by hand.', '');
  lines.push(`- OpenStreetMap data as of: ${osmDate}`);
  lines.push(`- Rivers: ${final.rivers.length}`);
  lines.push(`- Lakes and reservoirs: ${final.lakes.length}`);
  lines.push(`- Cities and towns: ${final.cities.length}`);
  lines.push(`- Municipalities: ${final.municipalities.length}`);
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

  // Rivers joined across a gap
  lines.push('## Rivers joined across a gap', '');
  if (!joins.length) lines.push('None.');
  else {
    lines.push(`Pieces with the same name and a gap of up to ${JOIN_GAP_METRES / 1000} km were joined`);
    lines.push('into one river. Check that they really are the same river.', '');
    for (const j of [...joins].sort((a, b) => a.name.localeCompare(b.name))) {
      const gaps = j.gaps.map((g) => (g < 1000 ? `${g} m` : `${(g / 1000).toFixed(1)} km`));
      lines.push(`- **${j.name}**: ${j.pieces} pieces, gaps ${gaps.join(', ')}`);
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

  // Cities and municipalities
  lines.push('## Cities and towns', '');
  lines.push(final.cities.map((f) => `${f.properties.name}${f.properties.place === 'city' ? ' (city)' : ''}`)
    .join(', '), '');
  lines.push('## Municipalities', '');
  lines.push(final.municipalities.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b, 'mk'))
    .join(', '), '');

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

// Prefer the explicit Macedonian name; fall back to the main name. If the main
// name is in several languages ("Lepenc / Лепенец", "Дојранско Езеро / Λίμνη
// Δοϊράνη") and exactly one part is Cyrillic, use that part.
function macedonianName(tags) {
  if (tags['name:mk']?.trim()) return tags['name:mk'].trim();
  const name = (tags.name || '').trim();
  const parts = name.split('/').map((p) => p.trim()).filter(Boolean);
  const cyrillic = parts.filter((p) => /[Ѐ-ӿ]/.test(p));
  return parts.length > 1 && cyrillic.length === 1 ? cyrillic[0] : name;
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
