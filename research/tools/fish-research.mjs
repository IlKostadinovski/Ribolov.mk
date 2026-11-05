// Research helper (research branch only, not part of the website).
//
// For every species in research/fishbase/species.txt it collects:
//   research/fish/wikidata.json          Wikidata item, main picture, Commons category,
//                                        common names, Wikipedia titles, IUCN status
//   research/fish/candidates/<Genus-species>/NN.jpg   small previews of free pictures
//   research/fish/candidates.tsv         one line per preview: file, licence, author, size
//   research/fish/fishbase/<Genus-species>.txt        FishBase summary page as text
//   research/fish/wiki-en|wiki-mk/<Genus-species>.txt Wikipedia article as plain text
//
// The previews are only for choosing a picture; the site downloads its own copy of the
// chosen file (see tools/fetch-fish-images.mjs on main).
//
// Run with Node 22: node research/tools/fish-research.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const UA = 'RibolovMK-research/1.0 (https://github.com/IlKostadinovski/Ribolov.mk)';
const OUT = 'research/fish';
const PER_SPECIES = 12; // previews per species
const FREE = /^(public domain|pd|cc0|cc[- ]by(-sa)?[- ]?\d|cc[- ]by(-sa)?$)/i;
const SKIP_TITLE = /map|distribution|range|verbreitung|areal|stamp|briefmarke|marke|skeleton|otolith|scale|\.svg$|\.tiff?$|\.pdf$|\.djvu$|\.gif$|coat of arms|wappen|logo|chart|diagram/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (latin) => latin.replace(/ /g, '-');

async function get(url, type = 'json', tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (type === 'json') return await res.json();
      if (type === 'text') return await res.text();
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(3000 * i);
    }
  }
}

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

async function wikidata(names) {
  const values = names.map((n) => JSON.stringify(n)).join(' ');
  const query = `
SELECT ?name ?item ?image ?cat ?enLabel ?mkLabel ?enwiki ?mkwiki ?iucnLabel WHERE {
  VALUES ?name { ${values} }
  ?item wdt:P225 ?name .
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P373 ?cat }
  OPTIONAL { ?item rdfs:label ?enLabel FILTER(lang(?enLabel) = "en") }
  OPTIONAL { ?item rdfs:label ?mkLabel FILTER(lang(?mkLabel) = "mk") }
  OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?mkwiki schema:about ?item ; schema:isPartOf <https://mk.wikipedia.org/> }
  OPTIONAL { ?item wdt:P141 ?iucn . ?iucn rdfs:label ?iucnLabel FILTER(lang(?iucnLabel) = "en") }
}`;
  const common = `
SELECT ?name ?cn WHERE {
  VALUES ?name { ${values} }
  ?item wdt:P225 ?name ; wdt:P1843 ?cn .
  FILTER(lang(?cn) IN ("en", "mk"))
}`;
  const run = (q) => get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q));
  const [main, names2] = [await run(query), await run(common)];
  const out = {};
  const val = (b, k) => b[k]?.value;
  for (const b of main.results.bindings) {
    const name = val(b, 'name');
    const e = (out[name] ||= { items: [], images: [], commonNames: { en: [], mk: [] } });
    const add = (list, v) => { if (v && !list.includes(v)) list.push(v); };
    add(e.items, val(b, 'item'));
    if (val(b, 'image')) add(e.images, decodeURIComponent(val(b, 'image').split('/').pop()).replace(/_/g, ' '));
    e.category ||= val(b, 'cat');
    e.en ||= val(b, 'enLabel');
    e.mk ||= val(b, 'mkLabel');
    e.enwiki ||= val(b, 'enwiki') && decodeURIComponent(val(b, 'enwiki').split('/wiki/')[1]).replace(/_/g, ' ');
    e.mkwiki ||= val(b, 'mkwiki') && decodeURIComponent(val(b, 'mkwiki').split('/wiki/')[1]).replace(/_/g, ' ');
    e.iucn ||= val(b, 'iucnLabel');
  }
  for (const b of names2.results.bindings) {
    const e = out[val(b, 'name')];
    const lang = b.cn['xml:lang'];
    if (e && !e.commonNames[lang].includes(b.cn.value)) e.commonNames[lang].push(b.cn.value);
  }
  return out;
}

// Image info for a list of Commons file titles (max 50 per call).
async function imageInfo(titles) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: '320', titles: titles.join('|'),
  });
  const data = await get('https://commons.wikimedia.org/w/api.php?' + params);
  return (data.query?.pages || []).filter((p) => p.imageinfo).map((p) => ({ title: p.title, ...p.imageinfo[0] }));
}

async function categoryFiles(category) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', list: 'categorymembers',
    cmtitle: 'Category:' + category, cmtype: 'file', cmlimit: '60',
  });
  const data = await get('https://commons.wikimedia.org/w/api.php?' + params);
  return (data.query?.categorymembers || []).map((m) => m.title);
}

async function searchFiles(text) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', list: 'search',
    srsearch: `"${text}"`, srnamespace: '6', srlimit: '30',
  });
  const data = await get('https://commons.wikimedia.org/w/api.php?' + params);
  return (data.query?.search || []).map((s) => s.title);
}

async function wikiText(lang, title) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'extracts', explaintext: '1',
    redirects: '1', titles: title,
  });
  const data = await get(`https://${lang}.wikipedia.org/w/api.php?` + params);
  return data.query?.pages?.[0]?.extract || '';
}

const species = (await readFile('research/fishbase/species.txt', 'utf8'))
  .split('\n').map((s) => s.trim()).filter(Boolean);

for (const dir of ['candidates', 'fishbase', 'wiki-en', 'wiki-mk']) await mkdir(`${OUT}/${dir}`, { recursive: true });

const wd = await wikidata(species);
await writeFile(`${OUT}/wikidata.json`, JSON.stringify(wd, null, 2) + '\n');
console.log(`::notice::Wikidata: ${Object.keys(wd).length} of ${species.length} species found`);

const tsv = ['species\tn\tfile\tlicence\tauthor\tsize\tsource'];
let previews = 0;
for (const latin of species) {
  const e = wd[latin] || { images: [] };
  try {
    // Candidates: the Wikidata picture(s) first, then the species category, then a search.
    const titles = [...e.images.map((f) => 'File:' + f)];
    const fromCat = await categoryFiles(e.category || latin).catch(() => []);
    for (const t of fromCat) if (!titles.includes(t)) titles.push(t);
    if (titles.length < PER_SPECIES * 2) {
      for (const t of await searchFiles(latin).catch(() => [])) if (!titles.includes(t)) titles.push(t);
    }
    const usable = titles.filter((t) => !SKIP_TITLE.test(t)).slice(0, 50);
    const infos = usable.length ? await imageInfo(usable) : [];
    const byTitle = new Map(infos.map((i) => [i.title, i]));
    let n = 0;
    for (const title of usable) {
      const info = byTitle.get(title);
      if (!info || !/image\/(jpeg|png|webp)/.test(info.mime) || info.width < 500) continue;
      const licence = stripHtml(info.extmetadata?.LicenseShortName?.value);
      if (!FREE.test(licence)) continue;
      n++;
      const name = String(n).padStart(2, '0');
      const img = await get(info.thumburl, 'buffer').catch(() => null);
      if (img) await mkdir(`${OUT}/candidates/${slug(latin)}`, { recursive: true }).then(() =>
        writeFile(`${OUT}/candidates/${slug(latin)}/${name}.jpg`, img));
      tsv.push([latin, name, title.replace(/^File:/, ''), licence,
        stripHtml(info.extmetadata?.Artist?.value).slice(0, 120), `${info.width}x${info.height}`,
        e.images.includes(title.replace(/^File:/, '')) ? 'wikidata' : 'commons'].join('\t'));
      previews++;
      await sleep(150);
      if (n >= PER_SPECIES) break;
    }
  } catch (err) {
    console.log(`::warning::${latin} pictures: ${err.message}`);
  }

  // FishBase summary page as text.
  try {
    const html = await get(`https://www.fishbase.se/summary/${slug(latin)}.html`, 'text');
    await writeFile(`${OUT}/fishbase/${slug(latin)}.txt`, stripHtml(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')) + '\n');
  } catch (err) {
    console.log(`::warning::${latin} FishBase: ${err.message}`);
  }
  // Wikipedia articles (English and Macedonian), as leads only.
  for (const [lang, title] of [['en', e.enwiki || latin], ['mk', e.mkwiki]]) {
    if (!title) continue;
    try {
      const text = await wikiText(lang, title);
      if (text) await writeFile(`${OUT}/wiki-${lang}/${slug(latin)}.txt`, text + '\n');
    } catch (err) {
      console.log(`::warning::${latin} Wikipedia ${lang}: ${err.message}`);
    }
  }
  await sleep(1500);
}
await writeFile(`${OUT}/candidates.tsv`, tsv.join('\n') + '\n');
console.log(`::notice::${previews} picture previews for ${species.length} species`);
