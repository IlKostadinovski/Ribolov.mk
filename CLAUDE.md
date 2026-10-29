# CLAUDE.md – project notes for AI assistants

Read this first in every new session. Keep it updated whenever a decision is made.

## Project

**RibolovMK** (repo `IlKostadinovski/Ribolov.mk`) is a static website with an interactive
fishing map of North Macedonia. The map shows ONLY:

- the country's border outline
- rivers
- lakes and reservoirs

No base map (no roads, cities or satellite tiles; may be added later).
Clicking/tapping a river or lake opens an info panel with:

- fish species living there
- where to get a fishing permit (issuing association/club, contact, price)
- closed seasons, catch limits, minimum sizes
- protected species and no-fishing zones
- notes

Features will be added step by step (fishing spots, photos, search, seasons, …), so the
code must stay simple, readable and easy to extend.

## Hard rules

- **Never invent fish species, permit details, prices or rules.** They have legal and
  practical consequences. The owner provides the real data. Until then only clearly
  marked placeholder entries (Lake Ohrid, Lake Dojran, Vardar) are allowed.
- Static site only: plain HTML/CSS/JavaScript, no backend, no build step needed to serve.
- Hosted on GitHub Pages: relative paths only.
- Libraries from a CDN, with pinned versions.
- Show "© OpenStreetMap contributors" on the map (required by the ODbL).
- All UI text in one place, so the site can be in Macedonian and English.
- Fishing content lives only in `data/waters.json`, linked to the map by water id.
  Water bodies without content show "No information yet".
- Must work well on phones: zoom/pan, wider invisible tap area for thin rivers,
  hover and selected highlight.
- Ask the owner before big decisions. Suggest improvements, but don't build extra
  features without asking. Explain things in plain steps.
- Never print, commit or write access tokens into any file.

## Map data

- Source: OpenStreetMap via the Overpass API (`overpass-api.de`):
  - border: country relation, `admin_level=2`, `ISO3166-1=MK`
  - rivers: `waterway=river`, named only (no small streams yet)
  - lakes: `natural=water` with `water=lake` or `water=reservoir`, named only
- Clip everything to the border. Shared lakes (Ohrid, Prespa, Dojran) show only the
  Macedonian part, with the border line running through them.
- Merge river segments by name, so clicking anywhere selects the whole river.
- Keep `name` (Macedonian), `name:en` (English) and a stable `id` per water body.
- Simplify the geometry (mapshaper) so the site loads fast.
- The download/processing script lives in the repo so data can be regenerated;
  the final GeoJSON is committed.

How it is built (implemented):
- `scripts/build-map-data.mjs` (Node, mapshaper + osmtogeojson, versions pinned in
  `scripts/package.json`) writes `data/map/border.geojson`, `rivers.geojson`,
  `lakes.geojson` and `report.md`.
- It runs on **GitHub Actions** (`.github/workflows/update-map-data.yml`), because the
  Claude sandbox can't reach Overpass. It runs automatically when `scripts/**` or the
  workflow changes, or by hand: Actions → "Update map data" → Run workflow. The Action
  commits the new `data/map/` files itself ("Update map data from OpenStreetMap").
  After pushing a script change, wait for the run, then `git pull` to get the data.
- Local test without network: `node build-map-data.mjs --cached` reuses `scripts/cache/`
  (gitignored). Note it overwrites `data/map/`; restore with `git checkout -- data/map`.
- Feature properties: `id`, `name`, `name:en` (or null), `type` (`river`, `lake`,
  `reservoir`). Rivers are MultiLineString, lakes Polygon/MultiPolygon.
- Name rule: `name:mk` if present, else `name`; if `name` is multilingual
  ("Lepenc / Лепенец") and exactly one part is Cyrillic, that part is used.
- River merging: ways with the same name are joined if they share a node, or if the gap
  between pieces is ≤ 7 km (`JOIN_GAP_METRES`). OSM has many small gaps (Bregalnica,
  Lepenec, the Vardar source). Different rivers with the same name are far apart
  (≥ 33 km in the first download). Joins are listed in `report.md`.
- Ids: slug of the Macedonian name, transliterated to Latin (`ohridsko-ezero`, `vardar`).
  Same-named waters get `-2`, `-3`, … (lakes before rivers, then biggest first).
  **Ids are what `data/waters.json` links to — don't change the id rules lightly**, and
  check `report.md` for renamed ids after each data update.
- `report.md`: counts, same-name groups, gap joins, and the full id list (the owner uses
  it to find ids). First download: 194 rivers, 80 lakes/reservoirs, ~765 KB GeoJSON.
- Some odd names come straight from OSM (a river named "4.", "X Канал",
  "Srebreno ezero 2.182 masl"); fixing them in OSM fixes them here on the next run.

## Decisions

Decided:
- Repo: `IlKostadinovski/Ribolov.mk` (public), branch `main`.
- `data/waters.json` format: see README.md (each text can be plain or `{ "mk", "en" }`).
- Map data is built by a GitHub Action, not in the Claude sandbox (see "Map data").
- GitHub Pages is on (deploy from branch `main`, root):
  https://ilkostadinovski.github.io/Ribolov.mk/

Implemented, waiting for the owner's OK:
- **Merge rivers by name + connectivity + 7 km gap rule** (see "Map data"), so different
  rivers with the same name (e.g. several "Мала Река") stay separate.
- **Readable slug ids** (e.g. `vardar`, `ohridsko-ezero`) instead of OSM ids, because OSM
  ids can change between downloads and would break the links in `waters.json`.

Proposed, waiting for the owner's OK:
- **Leaflet without a tile layer** (rather than D3): built-in zoom/pan/touch, attribution
  control, and a base map or fishing-spot markers can be added later with little code.

Open questions:
- Default site language: Macedonian or English?

## File layout

```
index.html              (planned)
css/style.css           (planned)
js/i18n.js              (planned) all UI text (mk + en)
js/app.js               (planned) map + info panel
data/waters.json        (planned) fishing content (edited by the owner)
data/map/border.geojson generated by the Action, don't edit by hand
data/map/rivers.geojson generated
data/map/lakes.geojson  generated
data/map/report.md      generated: id list, duplicate names, gap joins
scripts/                download + processing of the OSM data
.github/workflows/update-map-data.yml   runs the script on GitHub
```

## Status – first milestone

- [x] 1. CLAUDE.md + README.md
- [x] 2. Map data downloaded, processed and committed (via GitHub Actions)
- [ ] 3. Working map: border, rivers, lakes, clickable, info panel
- [ ] 4. Placeholder content for Lake Ohrid (`ohridsko-ezero`), Lake Dojran
      (`dojransko-ezero`), Vardar (`vardar`)
- [ ] 5. Instructions for turning on GitHub Pages (Pages is already on; explain how to
      open the site and how updates appear)

## Working environment notes

- Sessions run in claude.ai with a cloud sandbox. GitHub access goes through the owner's
  **Claude GitHub connection**: attach the repo to the session (add_repo, push access),
  use the plain remote `https://github.com/IlKostadinovski/ribolov.mk`, and the git proxy
  supplies credentials. No personal access token is needed (an earlier token was used
  only at the start). Never echo, store or commit tokens.
- The sandbox can reach npm and GitHub, but not `overpass-api.de` or
  `ilkostadinovski.github.io` (so the live site can't be checked from the sandbox).
- Check Action runs with `gh api repos/IlKostadinovski/ribolov.mk/actions/runs`.
