# Research branch

Working material for the fishing information on the site. Not part of the website.

- `urls.txt`: documents to download.
- `text/`: the documents converted to plain text by the "Fetch research sources" Action.
- The sources actually used on the site are listed in `SOURCES.md` on the `main` branch.
- `fish/` (Nov 2026, "Fish research" Action, `tools/fish-research.mjs`): for every species
  in `fishbase/species.txt`, Wikidata info (`wikidata.json`), FishBase summary pages as
  text (`fishbase/`), Wikipedia text as leads only (`wiki-en/`, `wiki-mk/`), and Wikimedia
  Commons picture candidates (`candidates/` + `candidates.tsv` with licence and author;
  a wider second search for `retry.txt` in `candidates2/`). The pictures chosen for the
  site are in `data/fish.json` on `main`.
