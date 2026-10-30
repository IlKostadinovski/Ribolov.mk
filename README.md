# RibolovMK

Interactive fishing map of North Macedonia: rivers, lakes and reservoirs, with fishing
information for each one.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).

**The site:** https://ilkostadinovski.github.io/Ribolov.mk/

The fishing information comes only from reliable sources (official fishery management
plans, scientific papers, field surveys); see [`SOURCES.md`](SOURCES.md).

## Seeing your changes on the site

The site is published with GitHub Pages from the `main` branch. Every change saved on
`main` (by you on GitHub, or by Claude) appears on the site by itself:

1. Save (commit) the change.
2. Wait 1–2 minutes. You can watch the progress in the **Actions** tab: the run called
   "pages build and deployment" turns green when the site is updated.
3. Open the site and refresh the page. If you still see the old version, do a hard
   refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac), or on a phone close the tab
   and open the link again.

If GitHub Pages is ever turned off: repository **Settings → Pages**, set **Source** to
"Deploy from a branch", **Branch** to `main` and the folder to `/ (root)`, then **Save**.

## How the site is built

| File | What it is |
|---|---|
| `index.html` | The page |
| `css/style.css` | Colours and layout (map colours are the `--map-…` values at the top) |
| `js/i18n.js` | All texts on the site, in Macedonian and English |
| `js/app.js` | The map and the info panel |
| `data/waters.json` | Fishing information (see below) |
| `data/map/` | Rivers, lakes and border (generated, don't edit by hand) |
| `scripts/` | The script that downloads the map data from OpenStreetMap |

The site opens in Macedonian; the **EN / МК** button in the top right switches language
and the site remembers the choice. The **Филтер** button in the top left shows or hides
rivers, lakes, reservoirs, cities and municipality borders.

The map shows the main city of each municipality as a white area; its name appears when
you hover over it (or tap it on a phone).

## Editing the fishing information

All fishing information lives in **one file: `data/waters.json`**.
You can update it without touching any code.

### How to edit on GitHub

1. Open `data/waters.json` on GitHub and click the **pencil icon** (Edit).
2. Make your changes.
3. Click **Commit changes…**, write a short note about what you changed, and confirm.
4. The website updates by itself within a minute or two. Refresh the page to see it.

### What an entry looks like

Each river or lake has its own entry, under its **id**:

```json
{
  "ohridsko-ezero": {
    "description": { "mk": "Кратко за езерото…", "en": "A short description…" },
    "fish": [
      { "latin": "Salmo letnica", "mk": "Охридска пастрмка", "en": "Ohrid trout", "endemic": true },
      { "latin": "Carassius gibelio", "mk": "Сребрен карас", "en": "Prussian carp", "introduced": true }
    ],
    "fishNote": { "mk": "Од каде е списокот на риби…", "en": "Where the fish list comes from…" },
    "permits": [
      {
        "issuer": "Name of the fishing association or club",
        "contact": "Phone, email, address or website",
        "price": "Price and what it covers (one day, one year, …)"
      }
    ],
    "closedSeasons": ["Fish species 1: from DATE to DATE"],
    "catchLimits": "How many fish per person per day",
    "minimumSizes": [
      { "fish": "Fish species 1", "size": "XX cm" }
    ],
    "protectedSpecies": ["Fish species that must be released"],
    "noFishingZones": ["Description of the area where fishing is forbidden"],
    "notes": ["Important fact 1", "Important fact 2"],
    "sources": [
      { "title": "Name of the document", "url": "https://…" }
    ]
  }
}
```

Every field is optional. Leave out what you don't know yet; the panel only shows
what is filled in. A river or lake with no entry at all shows "No information yet".

| Field | What to write |
|---|---|
| `description` | A short description of the water |
| `fish` | List of fish. Best as `latin` + `mk` + `en` names (see below) |
| `fishNote` | Where the fish list comes from / what it covers |
| `permits` | List of places that issue permits: `issuer`, `contact`, `price` |
| `closedSeasons` | List of closed seasons |
| `catchLimits` | Catch limits |
| `minimumSizes` | List of `fish` + `size` pairs |
| `protectedSpecies` | List of protected species |
| `noFishingZones` | List of areas where fishing is not allowed |
| `notes` | Important facts (one text, or a list) |
| `sources` | Where the information comes from: `title` and `url` (shown as links) |
| `placeholder` | `true` = example data only, shown with a warning on the site |

### Fish and the fish filter

Write each fish with its scientific (Latin) name:

```json
{ "latin": "Cyprinus carpio", "mk": "Крап", "en": "Common carp" }
```

- The **Latin name** connects the same fish across all waters. The "Риба / Fish" list in
  the filter is built from these names, so write each species exactly the same way
  everywhere (same spelling, same capital letter).
- `mk` and `en` are the names shown on the site. If `en` is missing, English visitors see
  the Latin name.
- Optional tags: `"endemic": true` (lives only in this lake/region) and
  `"introduced": true` (brought in by people). Only add them if a source says so.
- The site shows each fish list **biggest species first**, whatever order you write
  them in. The sizes are in `data/fish-sizes.json` (Latin name → maximum length in cm).
  When you add a species that is not there yet, add a line for it too, e.g.
  `"Esox lucius": 150,`. A species without a size is shown at the end of the list.

### Sources

Every fact on the site should have a source. Add it to the water's `sources` list and to
[`SOURCES.md`](SOURCES.md), which lists all sources and the rules used for adding
information.

### Text in two languages

Any text can be written once:

```json
"notes": "Риболов само од брег."
```

or in both languages:

```json
"notes": { "mk": "Риболов само од брег.", "en": "Fishing from the shore only." }
```

The site shows the version for the chosen language. If one language is missing, it
shows the other one.

### Finding the id of a river or lake

Every river and lake has a short id such as `vardar` or `ohridsko-ezero`. You can find
all of them in **[`data/map/report.md`](data/map/report.md)**, in the "All waters" table
(open the file on GitHub and use your browser's search, Ctrl+F / Cmd+F, to look for a
name). The id in `waters.json` must match exactly.

If two waters have the same name, the second one gets `-2`, the third `-3`, and so on
(e.g. `mala-reka-2`). The report lists these too.

### Placeholders

Entries with `"placeholder": true` are only examples to demonstrate the info panel.
They are **not** real fishing information. Replace them with real data and delete the
`"placeholder": true` line, or delete the whole entry.

### Common mistakes

- Text must be inside double quotes: `"like this"`.
- Separate items with commas, but put **no comma after the last item** in a list `[ ]`
  or an entry `{ }`.
- If the info panel stops working after an edit, the file probably has a typo.
  Paste it into [jsonlint.com](https://jsonlint.com) to find the exact line.

## Updating the map data

The rivers, lakes and border come from OpenStreetMap. To download the latest version:

1. Open the repository on GitHub and click the **Actions** tab.
2. Click **Update map data** on the left.
3. Click **Run workflow**, then the green **Run workflow** button.
4. After a few minutes the new data is saved in `data/map/` automatically, and the
   site updates shortly after.

Check `data/map/report.md` afterwards: if a river or lake was renamed in OpenStreetMap,
its id may have changed, and its entry in `waters.json` must be renamed to match.
