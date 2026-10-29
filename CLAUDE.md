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

## Map data (plan)

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

## Decisions

Decided:
- Repo: `IlKostadinovski/Ribolov.mk` (public), branch `main`.
- `data/waters.json` format: see README.md (each text can be plain or `{ "mk", "en" }`).

Proposed, waiting for the owner's OK:
- **Leaflet without a tile layer** (rather than D3): built-in zoom/pan/touch, attribution
  control, and a base map or fishing-spot markers can be added later with little code.
- **Merge rivers by name AND connectivity**: segments are joined only if they share a name
  and touch, so different rivers with the same name (e.g. several "Бела Река") stay
  separate. The build script prints a report of duplicate names to review.
- **Readable slug ids** (e.g. `vardar`, `ohridsko-ezero`) instead of OSM ids, because OSM
  ids can change between downloads and would break the links in `waters.json`.

Open questions:
- Default site language: Macedonian or English?

## Planned file layout

```
index.html
css/style.css
js/i18n.js              all UI text (mk + en)
js/app.js               map + info panel
data/waters.json        fishing content (edited by the owner)
data/map/border.geojson
data/map/rivers.geojson
data/map/lakes.geojson
scripts/                download + processing of the OSM data
```

## Status – first milestone

- [x] 1. CLAUDE.md + README.md
- [ ] 2. Map data downloaded, processed and committed
      (blocked: `overpass-api.de` must be allowed in the claude.ai network settings)
- [ ] 3. Working map: border, rivers, lakes, clickable, info panel
- [ ] 4. Placeholder content for Lake Ohrid, Lake Dojran, Vardar
- [ ] 5. Instructions for turning on GitHub Pages

## Working environment notes

- Sessions so far run in claude.ai with a sandbox. Pushing uses a short-lived,
  fine-grained GitHub token supplied by the owner (Contents: read & write, this repo
  only). Never echo it or store it in the repo.
- The sandbox only reaches allow-listed domains: npm and GitHub work;
  `overpass-api.de` is needed for the map data.
