// Downloads the fish pictures chosen in data/fish.json from Wikimedia Commons.
//
// In data/fish.json a fish's "image" is the name of a file on Wikimedia Commons,
// e.g. "Cyprinus carpio.jpeg" (or { "file": "…", "author": "…" } to write the author's
// name more simply than Commons does). This script saves a copy, 800 pixels wide, in
// images/fish/ and writes data/fish-images.json with the author and licence of each
// picture, which the site shows under it.
//
// Only free pictures are used: public domain, CC0, CC BY and CC BY-SA.
// It runs on GitHub (Actions → "Update fish pictures"), because the Claude sandbox
// can't reach Wikimedia. Node 22, no packages needed:  node tools/fetch-fish-images.mjs

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const UA = 'RibolovMK/1.0 (https://github.com/IlKostadinovski/Ribolov.mk)';
const WIDTH = 800;
const FOLDER = 'images/fish';
const FREE = /^(public domain|pd\b|cc0|cc[- ]by(-sa)?\b)/i;

const fish = JSON.parse(await readFile('data/fish.json', 'utf8'));
const old = JSON.parse(await readFile('data/fish-images.json', 'utf8').catch(() => '{}'));
const result = {};
const kept = new Set();
let problems = 0;

const strip = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const slug = (latin) => latin.toLowerCase().replace(/[^a-z]+/g, '-');

async function get(url, type) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return type === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

await mkdir(FOLDER, { recursive: true });

for (const [latin, page] of Object.entries(fish)) {
  const choice = typeof page?.image === 'string' ? { file: page.image } : page?.image;
  if (!choice?.file) continue;
  const file = choice.file.replace(/^File:/, '').replace(/_/g, ' ');
  try {
    // Same file as last time: keep the copy we have.
    const before = old[latin];
    if (before?.file === file) {
      try {
        await readFile(before.src);
        result[latin] = { ...before, ...(choice.author ? { author: choice.author } : {}) };
        kept.add(before.src.split('/').pop());
        continue;
      } catch { /* the copy is missing: download again */ }
    }
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
      iiprop: 'url|size|extmetadata', iiurlwidth: String(WIDTH), titles: 'File:' + file,
    });
    const data = await get('https://commons.wikimedia.org/w/api.php?' + params, 'json');
    const info = data.query?.pages?.[0]?.imageinfo?.[0];
    if (!info) throw new Error('file not found on Wikimedia Commons');
    const meta = info.extmetadata || {};
    const licence = strip(meta.LicenseShortName?.value);
    if (!FREE.test(licence)) throw new Error(`licence "${licence}" is not free enough`);

    const url = info.thumburl || info.url;
    const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
    const name = `${slug(latin)}.${ext}`;
    await writeFile(`${FOLDER}/${name}`, await get(url, 'buffer'));
    kept.add(name);
    result[latin] = {
      src: `${FOLDER}/${name}`,
      file,
      page: info.descriptionurl,
      author: choice.author || strip(meta.Artist?.value) || strip(meta.Credit?.value) || null,
      licence,
      licenceUrl: meta.LicenseUrl?.value || null,
      width: info.thumbwidth || info.width,
      height: info.thumbheight || info.height,
    };
    console.log(`${latin}: ${file} (${licence})`);
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    problems++;
    console.log(`::warning::${latin}: ${file}: ${err.message}`);
  }
}

// Pictures that are no longer used are deleted.
for (const name of await readdir(FOLDER)) {
  if (!kept.has(name) && name !== '.gitkeep') await rm(`${FOLDER}/${name}`);
}

const sorted = Object.fromEntries(Object.keys(result).sort().map((k) => [k, result[k]]));
await writeFile('data/fish-images.json', JSON.stringify(sorted, null, 2) + '\n');
console.log(`::notice::${Object.keys(result).length} fish pictures, ${problems} problem(s)`);
