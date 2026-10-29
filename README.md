# RibolovMK

Interactive fishing map of North Macedonia: rivers, lakes and reservoirs, with fishing
information for each one.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).

**The site:** https://ilkostadinovski.github.io/Ribolov.mk/

The fishing information for Lake Ohrid, Lake Dojran and the Vardar is only an example
(marked "Пример" / "Example" on the site) until the real data is added.

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
and the site remembers the choice.

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
    "placeholder": true,
    "fish": ["Fish species 1", "Fish species 2"],
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
    "notes": "Anything else worth knowing"
  },

  "vardar": {
    "fish": ["…"]
  }
}
```

Every field is optional. Leave out what you don't know yet; the panel only shows
what is filled in. A river or lake with no entry at all shows "No information yet".

| Field | What to write |
|---|---|
| `fish` | List of fish species living there |
| `permits` | List of places that issue permits: `issuer`, `contact`, `price` |
| `closedSeasons` | List of closed seasons |
| `catchLimits` | Catch limits |
| `minimumSizes` | List of `fish` + `size` pairs |
| `protectedSpecies` | List of protected species |
| `noFishingZones` | List of areas where fishing is not allowed |
| `notes` | Free text |
| `placeholder` | `true` = example data only, shown with a warning on the site |

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
