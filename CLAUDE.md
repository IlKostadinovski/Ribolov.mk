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
  it to find ids). Current data: 177 rivers, 80 lakes/reservoirs, ~760 KB GeoJSON. "Lepenc" (Albanian-only
  name in OSM) is still separate from "Лепенец"; fix in OSM or add an alias rule later.
- Some odd names come straight from OSM (a river named "4.", "X Канал",
  "Srebreno ezero 2.182 masl"); fixing them in OSM fixes them here on the next run.
- **Municipalities** (`municipalities.geojson`): `admin_level=7` relations (`MUNICIPALITY_LEVEL`),
  clipped, simplified with the border, then `-innerlines` → only the lines between
  neighbouring municipalities (no attributes). The build fails if the count isn't 60–100.
- **Cities** (`cities.geojson`, owner's spec): only the biggest place in each municipality
  (place city > town > village, then `population`), drawn as a white built-up area, no
  labels; the name shows on hover (tap on phones). The area = OSM
  `landuse=residential|commercial|retail` around the place (second Overpass query with one
  `around` per place), grown 60 m, dissolved, shrunk 50 m, exploded; the piece containing
  (or within 400 m of) the place is used. No land use → small circle. Several seats sharing
  one area (Skopje's municipalities) → one feature, named after the biggest. Properties:
  `id`, `name`, `name:en`, `place`, `population`, `municipality`, `shape`.

## Decisions

Decided:
- Repo: `IlKostadinovski/Ribolov.mk` (public), branch `main`.
- `data/waters.json` format: see README.md (each text can be plain or `{ "mk", "en" }`).
- Map data is built by a GitHub Action, not in the Claude sandbox (see "Map data").
- GitHub Pages is on (deploy from branch `main`, root):
  https://ilkostadinovski.github.io/Ribolov.mk/
- **Leaflet 1.9.4** without a tile layer (owner OK'd; may revisit later).
- **Default language Macedonian**, with an EN/МК switch (choice saved in localStorage).

Implemented, owner hasn't objected (treat as decided unless they say otherwise):
- **Merge rivers by name + connectivity + 7 km gap rule** (see "Map data"), so different
  rivers with the same name (e.g. several "Мала Река") stay separate.
- **Readable slug ids** (e.g. `vardar`, `ohridsko-ezero`) instead of OSM ids, because OSM
  ids can change between downloads and would break the links in `waters.json`.

## The site (how it works)

- `index.html` loads Leaflet from unpkg (pinned 1.9.4 with SRI hashes), Golos Text from
  Google Fonts (has full Macedonian Cyrillic), then `js/i18n.js` and `js/app.js`.
  No build step; plain scripts (top-level consts in i18n.js are shared globals).
- `js/i18n.js`: `DEFAULT_LANG`, `LANGUAGES`, `TEXT.mk` / `TEXT.en`. Every visible string.
- `js/app.js`:
  - One Leaflet **canvas** renderer for everything (fast on phones).
  - Draw order (`DRAW_ORDER`): border (fills the land colour) → cities → municipality
    lines → visible river lines (non-interactive) → invisible river tap lines
    (`RIVER_TAP_WIDTH` 18 px touch / 8 px mouse, opacity 0) → lakes → reservoirs.
    Lakes on top so a tap inside a lake picks the lake; cities at the bottom so water wins.
  - **Filter** (top left, `FILTERS`): rivers, lakes, reservoirs, cities, municipality
    borders, all on by default (not remembered). `applyFilters()` removes all groups and
    re-adds the ticked ones in `DRAW_ORDER`, so order and tap priority never change. If the
    selected water gets hidden, the panel closes. Zoom buttons are bottom right.
  - River width depends on length (computed in JS) and zoom.
  - States: normal / hover (darker blue) / selected (red, `--map-selected`).
    Hover tooltips with the name only on devices that can hover.
  - Info panel: right-hand card on desktop, bottom sheet (max 55% height) on phones.
    `keepVisible()` pans the map so the tapped spot isn't hidden behind the panel.
  - The map view is set before layers are added (Leaflet canvas didn't draw otherwise).
  - `maxBounds` = border bounds padded ×2 (smaller padding blocked panning on phones).
  - If `data/waters.json` fails to parse, the panel says so (helps the owner find typos).
- Colours live in `css/style.css` (`--map-*` variables, read by app.js).
- Design (owner's request): **black outside the country, gray country (`#44494e`), white
  country border, blue water, white cities**, municipality lines white at 40% opacity,
  dashed. Header and panels dark to match. Fishing-float red for the selection, Golos
  Text. Panel swatch mirrors the selected map symbol; filter rows show a mini legend.
- `.nojekyll` makes GitHub Pages serve the files as they are.

## Testing

- The sandbox can't reach unpkg/Google Fonts, so local tests serve the repo with
  `python3 -m http.server` and Playwright (Chromium in `/opt/pw-browsers`, set
  `PLAYWRIGHT_BROWSERS_PATH`) with `page.route()` serving Leaflet from `npm pack leaflet@1.9.4`
  and aborting the font request. Capture the map via an init script that wraps `L.map`.
- Check: river click a few px off the line, lake centre on phone, language switch,
  panel close (×, Esc, tap on empty map), broken waters.json message, no console errors.

## File layout

```
index.html
css/style.css
js/i18n.js              all UI text (mk + en)
js/app.js               map + info panel
data/waters.json        fishing content (edited by the owner)
data/map/border.geojson generated by the Action, don't edit by hand
data/map/rivers.geojson generated
data/map/lakes.geojson  generated
data/map/municipalities.geojson  generated (lines between municipalities)
data/map/cities.geojson generated (built-up areas, one per municipality)
data/map/report.md      generated: id list, duplicate names, gap joins
scripts/                download + processing of the OSM data
.github/workflows/update-map-data.yml   runs the script on GitHub
.nojekyll
```

## Status

First milestone: done.
- [x] 1. CLAUDE.md + README.md
- [x] 2. Map data downloaded, processed and committed (via GitHub Actions)
- [x] 3. Working map: border, rivers, lakes, clickable, info panel
- [x] 4. Placeholder content for Lake Ohrid (`ohridsko-ezero`), Lake Dojran
      (`dojransko-ezero`), Vardar (`vardar`), all marked `"placeholder": true`
- [x] 5. GitHub Pages instructions (README "Seeing your changes on the site")

Ideas to suggest later (not built, ask first): link to a selected water (`#vardar` in the
URL), search by name, fishing spots, photos, seasons view, merging "Lepenc" into
"Лепенец" with an alias list.

## Working environment notes

- Sessions run in claude.ai with a cloud sandbox. GitHub access goes through the owner's
  **Claude GitHub connection**: attach the repo to the session (add_repo, push access),
  use the plain remote `https://github.com/IlKostadinovski/ribolov.mk`, and the git proxy
  supplies credentials. No personal access token is needed (an earlier token was used
  only at the start). Never echo, store or commit tokens.
- The sandbox can reach npm and GitHub, but not `overpass-api.de`, unpkg, Google Fonts or
  `ilkostadinovski.github.io` (so the live site can't be checked from the sandbox).
- Check Action runs with `gh api repos/IlKostadinovski/ribolov.mk/actions/runs`.
