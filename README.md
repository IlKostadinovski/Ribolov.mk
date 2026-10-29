# RibolovMK

Interactive fishing map of North Macedonia: rivers, lakes and reservoirs, with fishing
information for each one.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).

> **Status:** work in progress, the map is not built yet.

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

Every river and lake has a short id such as `vardar` or `ohridsko-ezero`. The ids are
in the map files `data/map/rivers.geojson` and `data/map/lakes.geojson` (the `id` field).
The id in `waters.json` must match exactly.

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
