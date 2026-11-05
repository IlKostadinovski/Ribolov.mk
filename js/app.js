// RibolovMK – the map, the filter, the search and the info panel.
//
// Data it reads (all relative paths, so it works on GitHub Pages):
//   data/map/*.geojson   border, rivers, lakes, cities (generated, see scripts/)
//   data/map/municipalities.topojson   municipality areas (generated)
//   data/waters.json     fishing info per water, edited by hand
//   data/fish.json       fish pages (tips, baits, fun facts), edited by hand
//   data/fish-images.json  fish pictures and their credits (generated, see tools/)
// All visible text comes from js/i18n.js. Colours come from css/style.css.
// How typed text is matched to names is in js/search.js.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  const FILES = {
    border: 'data/map/border.geojson',
    rivers: 'data/map/rivers.geojson',
    lakes: 'data/map/lakes.geojson',
    municipalities: 'data/map/municipalities.topojson',
    cities: 'data/map/cities.geojson',
    waters: 'data/waters.json',
    fishSizes: 'data/fish-sizes.json',
    fish: 'data/fish.json',
    fishImages: 'data/fish-images.json',
  };

  // Map colours, read from the --map-* variables in css/style.css.
  const rootStyle = getComputedStyle(document.documentElement);
  const cssVar = (name) => rootStyle.getPropertyValue(name).trim();
  const COLORS = {
    land: cssVar('--map-land'),
    border: cssVar('--map-border'),
    municipality: cssVar('--map-municipality'),
    city: cssVar('--map-city'),
    water: cssVar('--map-water'),
    waterHover: cssVar('--map-water-hover'),
    lake: cssVar('--map-lake'),
    reservoir: cssVar('--map-reservoir'),
    lakeHover: cssVar('--map-lake-hover'),
    selected: cssVar('--map-selected'),
    fish: cssVar('--map-fish'),
    fishHover: cssVar('--map-fish-hover'),
    selectedWithFish: cssVar('--map-selected-with-fish'),
    dim: cssVar('--map-dim'),
  };

  // How dark the rest of the map gets while a municipality is chosen (0 = not at all).
  const DIM_OPACITY = 0.4;

  // What the filter can show or hide, in the order of the filter list.
  const FILTERS = ['rivers', 'lakes', 'reservoirs', 'cities', 'municipalities'];
  // The same layers in drawing order, bottom to top. Lakes and reservoirs are on
  // top, so a tap inside a lake always picks the lake, not a river under it.
  const DRAW_ORDER = ['cities', 'municipalities', 'rivers', 'lakes', 'reservoirs'];

  // Tap/click areas, in screen pixels. Every river also gets an invisible line
  // RIVER_TAP_WIDTH wide, so thin rivers are easy to hit with a finger.
  // TAP_TOLERANCE is a small extra margin around every shape.
  // (A "coarse" pointer is a finger; a mouse or pen is "fine".)
  const FINGER = window.matchMedia('(pointer: coarse)').matches;
  const RIVER_TAP_WIDTH = FINGER ? 18 : 8;
  const TAP_TOLERANCE = FINGER ? 6 : 3;

  // Show names next to the mouse (only on devices that can hover).
  const CAN_HOVER = window.matchMedia('(hover: hover)').matches;
  // Phones: the panel is a sheet at the bottom and the search box is short.
  const PHONE = window.matchMedia('(max-width: 640px)');

  // Search: how many suggestions to show, and which kind comes first when two
  // results match equally well.
  const SEARCH_MAX = 8;
  const SEARCH_ORDER = ['municipality', 'city', 'lake', 'reservoir', 'river', 'fish'];

  // The closest the map zooms in when it moves to a water or a city.
  const FOCUS_MAX_ZOOM = 12;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let lang = loadLanguage();
  let waters = {};              // contents of data/waters.json
  let fishSizes = {};           // Latin name -> maximum length in cm (data/fish-sizes.json)
  let fishPages = {};           // data/fish.json: Latin name -> tips, baits, fun facts, …
  let fishImages = {};          // data/fish-images.json: Latin name -> picture and credit
  let watersError = false;      // true if data/waters.json could not be read
  let fishError = false;        // true if data/fish.json could not be read
  let messageKey = null;        // error message currently shown, if any
  let selectedId = null;        // water drawn as selected on the map
  let hoveredId = null;
  let cityLabel = null;         // city name shown after a tap (phones) or a search
  let speciesFilter = null;     // Latin name of the fish whose waters are red, or null
  let chosenFish = null;        // fish chosen in the filter or the search (stays when the panel closes)
  const species = new Map();    // Latin name -> { latin, mk, en, names: Set, waters: Set of water ids }
  const layersById = new Map(); // water id -> visible map layer
  const cityLayers = [];        // map layers of the cities
  const groups = {};            // filter name -> map layer group
  const checkboxes = {};        // filter name -> its checkbox
  const slots = {};             // boxes in the filter for the municipality and fish lists
  const municipalities = new Map(); // municipality id -> GeoJSON area (from the TopoJSON file)
  let municipalityId = null;    // municipality chosen in the filter, or null
  let municipalityLayer = null; // the dimmed rest of the map + the municipality outline
  let municipalityZoom = null;  // zoom after fitting the municipality; zooming out further clears it
  let fitting = false;          // true while the map moves to a chosen municipality
  const visible = Object.fromEntries(FILTERS.map((key) => [key, true]));

  // The info panel shows one page: { type: 'water', id } or { type: 'fish', latin }.
  // Pages opened from another page can go back to it (backStack).
  let view = null;
  const backStack = [];         // earlier pages: { view, fish: the highlighted fish then }

  let searchIndex = null;       // everything the search can find; rebuilt when data arrives
  let searchResults = [];       // suggestions shown under the search box
  let searchActive = -1;        // suggestion picked with the arrow keys
  let searchChoice = null;      // the result chosen last (its name stays in the box)

  const el = {
    title: document.getElementById('site-title'),
    subtitle: document.getElementById('site-subtitle'),
    langSwitch: document.getElementById('lang-switch'),
    searchLabel: document.getElementById('search-label'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    searchList: document.getElementById('search-list'),
    map: document.getElementById('map'),
    filterToggle: document.getElementById('filter-toggle'),
    filterLabel: document.getElementById('filter-label'),
    filterList: document.getElementById('filter-list'),
    hint: document.getElementById('hint'),
    message: document.getElementById('message'),
    panel: document.getElementById('panel'),
    panelClose: document.getElementById('panel-close'),
    panelContent: document.getElementById('panel-content'),
  };

  // ---------------------------------------------------------------------------
  // Map
  // ---------------------------------------------------------------------------

  const map = L.map(el.map, {
    renderer: L.canvas({ tolerance: TAP_TOLERANCE, padding: 0.5 }),
    zoomControl: false,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
  });
  const zoomControl = L.control.zoom({ position: 'bottomright' }).addTo(map);
  // The dimmed rest of the map sits above the water but lets taps through (see CSS).
  map.createPane('dim').classList.add('dim-pane');
  const dimRenderer = L.canvas({ pane: 'dim', padding: 0.5 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  map.attributionControl.addAttribution(
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  );

  buildFilter();
  buildSearch();
  applyTexts();

  Promise.all([
    getJSON(FILES.border),
    getJSON(FILES.rivers),
    getJSON(FILES.lakes),
    getJSON(FILES.municipalities).catch(() => null), // optional layers: the map
    getJSON(FILES.cities).catch(() => null),         // still works without them
  ])
    .then(([border, rivers, lakes, municipalities, cities]) => {
      drawMap({ border, rivers, lakes, municipalities, cities });
    })
    .catch((err) => {
      console.error(err);
      showMessage('mapLoadError');
    })
    .finally(dataArrived);

  // Fish lists are shown biggest species first (fishermen look for the big ones).
  getJSON(FILES.fishSizes)
    .then((data) => { fishSizes = data || {}; })
    .catch(() => {}) // without it, fish keep the order of waters.json
    .finally(dataArrived);

  getJSON(FILES.waters)
    .then((data) => {
      waters = data || {};
      buildSpeciesFilter();
    })
    .catch((err) => {
      console.error('data/waters.json:', err);
      watersError = true;
    })
    .finally(dataArrived);

  getJSON(FILES.fish)
    .then((data) => { fishPages = data || {}; })
    .catch((err) => {
      console.error('data/fish.json:', err);
      fishError = true;
    })
    .finally(() => {
      fillSpeciesOptions(); // fish.json can add names
      dataArrived();
    });

  getJSON(FILES.fishImages)
    .then((data) => { fishImages = data || {}; })
    .catch(() => {}) // fish pages work without pictures
    .finally(dataArrived);

  // Some data has loaded: the search and the open page may have more to show.
  function dataArrived() {
    searchIndex = null;
    if (!el.searchList.hidden) updateSearch();
    if (view) renderPanel();
  }

  function drawMap(data) {
    // The border layer also fills the country with the land colour.
    const borderLayer = L.geoJSON(data.border, {
      interactive: false,
      style: { color: COLORS.border, weight: 1.5, fillColor: COLORS.land, fillOpacity: 1 },
    });

    // Set the view before adding layers (Leaflet only draws on a map that has a view).
    const bounds = borderLayer.getBounds();
    map.fitBounds(bounds, { padding: [8, 8] });
    map.setMinZoom(map.getZoom() - 1);
    map.setMaxBounds(bounds.pad(2)); // keeps the country in reach, with room for the panel

    for (const f of data.rivers.features) f.properties.lengthKm = lengthKm(f.geometry);
    const remember = (f, layer) => layersById.set(f.properties.id, layer);

    groups.rivers = L.layerGroup([
      L.geoJSON(data.rivers, { style: waterStyle, interactive: false, onEachFeature: remember }),
      L.geoJSON(data.rivers, {
        style: { weight: RIVER_TAP_WIDTH, opacity: 0, lineCap: 'round', lineJoin: 'round' },
        onEachFeature: listenForTaps,
      }),
    ]);
    for (const [key, type] of [['lakes', 'lake'], ['reservoirs', 'reservoir']]) {
      groups[key] = L.geoJSON(data.lakes, {
        filter: (f) => (f.properties.type === 'reservoir') === (type === 'reservoir'),
        style: waterStyle,
        onEachFeature: (f, layer) => { remember(f, layer); listenForTaps(f, layer); },
      });
    }
    // Municipalities come as TopoJSON: the lines between them for the map, and
    // the areas for the municipality filter (needs the topojson-client library).
    const topo = data.municipalities;
    if (topo && window.topojson) {
      const object = topo.objects.municipalities;
      groups.municipalities = L.geoJSON(topojson.mesh(topo, object, (a, b) => a !== b), {
        interactive: false,
        style: { color: COLORS.municipality, weight: 0.8, opacity: 0.4, dashArray: '4 4' },
      });
      for (const f of topojson.feature(topo, object).features) municipalities.set(f.properties.id, f);
      buildMunicipalityFilter();
    }
    groups.cities = L.geoJSON(data.cities, {
      style: { stroke: false, fillColor: COLORS.city, fillOpacity: 0.9 },
      onEachFeature: setUpCity,
    });

    borderLayer.addTo(map);
    applyFilters();
    map.on('zoomend', restyleAll);
    map.on('zoomend', clearMunicipalityOnZoomOut);
  }

  // Clicks, taps and hover on a water's tap area (for lakes, the lake itself).
  function listenForTaps(feature, layer) {
    const id = feature.properties.id;
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      closeCityName();
      select(id, e.latlng);
    });
    layer.on('mouseover', () => setHovered(id));
    layer.on('mouseout', () => setHovered(null));
    if (CAN_HOVER) {
      layer.bindTooltip(() => displayName(feature.properties), {
        sticky: true,
        direction: 'top',
        offset: [0, -10],
        className: 'map-tooltip',
      });
    }
  }

  // Cities show their name on hover, or after a tap on phones (until the next tap).
  const CITY_LABEL = { direction: 'top', offset: [0, -6], className: 'map-tooltip map-tooltip--city' };

  function setUpCity(feature, layer) {
    cityLayers.push(layer);
    if (CAN_HOVER) {
      layer.bindTooltip(() => displayName(feature.properties), { ...CITY_LABEL, sticky: true });
    }
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (CAN_HOVER) return;
      showCityName(feature, e.latlng);
    });
  }

  function showCityName(feature, latlng) {
    closeCityName();
    cityLabel = L.tooltip(CITY_LABEL)
      .setLatLng(latlng)
      .setContent(displayName(feature.properties))
      .addTo(map);
  }

  function closeCityName() {
    if (cityLabel) map.removeLayer(cityLabel);
    cityLabel = null;
  }

  // ---------------------------------------------------------------------------
  // Filter (top left)
  // ---------------------------------------------------------------------------

  function buildFilter() {
    for (const key of FILTERS) {
      const item = add(el.filterList, 'label', { className: 'filter-item' });
      const box = add(item, 'input');
      box.type = 'checkbox';
      box.checked = visible[key];
      box.addEventListener('change', () => {
        visible[key] = box.checked;
        applyFilters();
      });
      checkboxes[key] = box;
      add(item, 'span', { className: `legend legend--${key}` });
      add(item, 'span', { className: 'filter-text' }).dataset.text = key;
    }
    // Filled in when the data has loaded (always in this order).
    slots.municipality = add(el.filterList, 'div', { className: 'filter-pick' });
    slots.species = add(el.filterList, 'div', { className: 'filter-pick' });
    slots.municipality.hidden = true;
    slots.species.hidden = true;

    el.filterToggle.addEventListener('click', () => setFilterOpen(el.filterList.hidden));
  }

  function setFilterOpen(open) {
    el.filterList.hidden = !open;
    el.filterToggle.setAttribute('aria-expanded', String(open));
  }

  // Shows the layers that are ticked in the filter. Layers are re-added in
  // DRAW_ORDER every time, so the drawing order (and what a tap picks) never changes.
  function applyFilters() {
    hoveredId = null;
    closeCityName();
    for (const key of DRAW_ORDER) if (groups[key]) map.removeLayer(groups[key]);
    for (const key of DRAW_ORDER) if (groups[key] && visible[key]) map.addLayer(groups[key]);

    const selected = layersById.get(selectedId);
    if (selected && !visible[groupOf(selected.feature)]) closePanel();
    else if (selected) selected.bringToFront();
  }

  // Turns a layer back on (e.g. when the search goes to a river while rivers are hidden).
  function showLayer(key) {
    if (visible[key] || !groups[key]) return;
    visible[key] = true;
    if (checkboxes[key]) checkboxes[key].checked = true;
    applyFilters();
  }

  function groupOf(feature) {
    return { river: 'rivers', lake: 'lakes', reservoir: 'reservoirs' }[feature.properties.type];
  }

  // Fish filter: lists every species named in data/waters.json (by Latin name).
  // Choosing one colours the waters where it lives red.
  function buildSpeciesFilter() {
    species.clear();
    for (const [id, info] of Object.entries(waters)) {
      for (const fish of asList(info?.fish)) {
        if (!fish || typeof fish !== 'object' || !fish.latin) continue;
        const entry = species.get(fish.latin) || { latin: fish.latin, names: new Set(), waters: new Set() };
        entry.mk = entry.mk || fish.mk;
        entry.en = entry.en || fish.en;
        if (fish.mk) entry.names.add(fish.mk);
        if (fish.en) entry.names.add(fish.en);
        entry.waters.add(id);
        species.set(fish.latin, entry);
      }
    }
    if (!species.size) return;

    const box = slots.species;
    box.hidden = false;
    const label = add(box, 'label', { className: 'filter-pick-label' });
    label.htmlFor = 'species-select';
    label.dataset.text = 'fishFilter';
    label.textContent = t('fishFilter');
    const select = add(box, 'select', { id: 'species-select' });
    add(box, 'p', { className: 'filter-hint', id: 'species-count' });
    select.addEventListener('change', () => {
      highlightFish(select.value, { chosen: true });
      if (searchChoice?.type === 'fish') clearSearchText();
      if (view) renderPanel();
    });
    fillSpeciesOptions();
  }

  // (Re)writes the fish list in the current language, sorted by name.
  function fillSpeciesOptions() {
    const select = document.getElementById('species-select');
    if (!select) return;
    select.replaceChildren();
    add(select, 'option', { text: t('allSpecies') }).value = '';
    const sorted = [...species.values()].sort((a, b) => fishName(a).localeCompare(fishName(b), lang));
    for (const entry of sorted) {
      const name = fishName(entry);
      const option = add(select, 'option', { text: name === entry.latin ? name : `${name} (${entry.latin})` });
      option.value = entry.latin;
    }
    select.value = speciesFilter || '';
    updateSpeciesCount();
  }

  function updateSpeciesCount() {
    const count = document.getElementById('species-count');
    if (!count) return;
    const n = speciesFilter ? species.get(speciesFilter)?.waters.size || 0 : null;
    count.textContent = n === null ? t('speciesHint')
      : (n === 1 ? t('speciesCountOne') : t('speciesCount').replace('{n}', n));
  }

  // Colours the waters where this fish lives red (null = none). A fish chosen in
  // the filter or the search ({ chosen: true }) stays red when the panel closes;
  // one opened from a water's fish list only while its page is open.
  function highlightFish(latin, { chosen = false } = {}) {
    latin = latin || null;
    if (chosen) chosenFish = latin;
    if (latin !== speciesFilter) {
      speciesFilter = latin;
      document.body.classList.toggle('has-fish', Boolean(latin));
      restyleAll();
    }
    const select = document.getElementById('species-select');
    if (select) select.value = speciesFilter || '';
    updateSpeciesCount();
  }

  // Municipality filter: choosing one fits it on the screen and dims the rest of
  // the map. Zooming in keeps it; zooming out past that view clears it.
  function buildMunicipalityFilter() {
    const box = slots.municipality;
    box.hidden = false;
    const label = add(box, 'label', { className: 'filter-pick-label' });
    label.htmlFor = 'municipality-select';
    label.dataset.text = 'municipalityFilter';
    label.textContent = t('municipalityFilter');
    const select = add(box, 'select', { id: 'municipality-select' });
    add(box, 'p', { className: 'filter-hint', text: t('municipalityHint') }).dataset.text = 'municipalityHint';
    select.addEventListener('change', () => {
      if (select.value) showMunicipality(select.value);
      else clearMunicipality();
    });
    fillMunicipalityOptions();
  }

  function municipalityName(props) {
    return (lang === 'en' && props['name:en']) || props.name;
  }

  // (Re)writes the municipality list in the current language, sorted by name.
  function fillMunicipalityOptions() {
    const select = document.getElementById('municipality-select');
    if (!select) return;
    select.replaceChildren();
    add(select, 'option', { text: t('allMunicipalities') }).value = '';
    const sorted = [...municipalities.values()]
      .sort((a, b) => municipalityName(a.properties).localeCompare(municipalityName(b.properties), lang));
    for (const f of sorted) add(select, 'option', { text: municipalityName(f.properties) }).value = f.properties.id;
    select.value = municipalityId || '';
  }

  function showMunicipality(id) {
    const feature = municipalities.get(id);
    if (!feature) return;
    if (municipalityLayer) map.removeLayer(municipalityLayer);
    municipalityId = id;
    const select = document.getElementById('municipality-select');
    if (select) select.value = id;

    // A rectangle over the whole world with the municipality cut out of it
    // ("evenodd" filling also cuts out any islands of the municipality).
    const world = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
    const holes = polygonsOf(feature.geometry).flat().map((ring) => ring.map(([lon, lat]) => [lat, lon]));
    const onTop = { pane: 'dim', renderer: dimRenderer, interactive: false };
    municipalityLayer = L.layerGroup([
      L.polygon([world, ...holes], { ...onTop, stroke: false, fillColor: COLORS.dim, fillOpacity: DIM_OPACITY }),
      L.geoJSON(feature, { ...onTop, style: { color: COLORS.border, weight: 2, opacity: 0.9, fill: false } }),
    ]).addTo(map);

    // On phones the filter covers the map, so close it first.
    if (PHONE.matches) setFilterOpen(false);

    fitting = true;
    const done = () => {
      if (!fitting) return;
      fitting = false;
      municipalityZoom = map.getZoom();
    };
    map.once('moveend', done);
    setTimeout(done, 1500); // in case the map did not need to move
    map.fitBounds(L.geoJSON(feature).getBounds(), fitPadding());
  }

  function clearMunicipality() {
    if (municipalityLayer) map.removeLayer(municipalityLayer);
    municipalityLayer = null;
    municipalityId = null;
    municipalityZoom = null;
    const select = document.getElementById('municipality-select');
    if (select) select.value = '';
  }

  function clearMunicipalityOnZoomOut() {
    if (municipalityId && !fitting && municipalityZoom !== null && map.getZoom() < municipalityZoom - 0.01) {
      clearMunicipality();
    }
  }

  // Room around a fitted area, so the filter box and the info panel don't cover it.
  function fitPadding() {
    const mapBox = el.map.getBoundingClientRect();
    const pad = { top: 24, right: 24, bottom: 24, left: 24 };
    if (!el.filterList.hidden) {
      const filterRight = el.filterList.getBoundingClientRect().right - mapBox.left;
      if (filterRight < mapBox.width * 0.45) pad.left += filterRight;
    }
    if (!el.panel.hidden) {
      const panelBox = el.panel.getBoundingClientRect();
      if (panelBox.width >= mapBox.width - 1) pad.bottom += Math.max(0, mapBox.bottom - panelBox.top);
      else pad.right += Math.max(0, mapBox.right - panelBox.left);
    }
    return { paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom] };
  }

  // Moves the map to an area, keeping it clear of the filter and the panel.
  function fitArea(bounds) {
    if (!bounds?.isValid()) return;
    if (PHONE.matches) setFilterOpen(false);
    map.fitBounds(bounds, { ...fitPadding(), maxZoom: FOCUS_MAX_ZOOM });
  }

  // ---------------------------------------------------------------------------
  // Styles: normal, hover and selected; waters with the chosen fish are red
  // ---------------------------------------------------------------------------

  function waterStyle(feature) {
    const { id, type } = feature.properties;
    const state = id === selectedId ? 'selected' : id === hoveredId ? 'hover' : 'normal';
    const hasFish = Boolean(speciesFilter && species.get(speciesFilter)?.waters.has(id));
    // While a fish is shown in red, the selected water gets another colour,
    // so it can't be mistaken for a water with that fish.
    const selectedColor = speciesFilter ? COLORS.selectedWithFish : COLORS.selected;
    const lineColor = state === 'selected' ? selectedColor
      : hasFish ? (state === 'hover' ? COLORS.fishHover : COLORS.fish)
        : (state === 'hover' ? COLORS.waterHover : COLORS.water);

    if (type === 'river') {
      const width = riverWidth(feature.properties.lengthKm) * zoomFactor();
      return {
        color: lineColor,
        weight: width + (state === 'normal' ? 0 : 2) + (hasFish ? 1 : 0),
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      };
    }
    let fillColor = type === 'reservoir' ? COLORS.reservoir : COLORS.lake;
    if (hasFish) fillColor = state === 'hover' ? COLORS.fishHover : COLORS.fish;
    else if (state === 'hover') fillColor = COLORS.lakeHover;
    return {
      color: lineColor,
      weight: state === 'selected' ? 2.5 : hasFish ? 1.5 : state === 'hover' ? 2.5 : 1,
      opacity: 1,
      fillColor,
      fillOpacity: 1,
    };
  }

  // Long rivers are drawn thicker than short ones.
  function riverWidth(km) {
    if (km >= 100) return 2.5;
    if (km >= 30) return 1.7;
    return 1.2;
  }

  // Lines get a little thicker as you zoom in.
  function zoomFactor() {
    const z = map.getZoom();
    return Math.min(2.2, Math.max(0.8, 1 + (z - 8) * 0.25));
  }

  function restyle(id) {
    const layer = layersById.get(id);
    if (layer) layer.setStyle(waterStyle(layer.feature));
  }

  function restyleAll() {
    layersById.forEach((layer) => layer.setStyle(waterStyle(layer.feature)));
  }

  function setHovered(id) {
    const previous = hoveredId;
    hoveredId = id;
    restyle(previous);
    restyle(id);
  }

  function setSelected(id) {
    const previous = selectedId;
    selectedId = id;
    restyle(previous);
    restyle(id);
    layersById.get(id)?.bringToFront();
  }

  // ---------------------------------------------------------------------------
  // The info panel: a water's page or a fish's page
  // ---------------------------------------------------------------------------

  // A water tapped on the map.
  function select(id, latlng) {
    highlightFish(chosenFish); // a fish opened from a fish list stops being red
    showPage({ type: 'water', id });
    if (latlng) keepVisible(latlng);
  }

  // A fish tapped in a water's fish list: its page, with a back button.
  function openFish(latin) {
    showPage({ type: 'fish', latin }, { fromPage: true });
    highlightFish(latin);
  }

  // A water tapped on a fish's page: its page, with a back button.
  function openWater(id) {
    showPage({ type: 'water', id }, { fromPage: true });
    fitArea(layersById.get(id)?.getBounds());
  }

  // Shows a page in the panel. A page opened from another page ({ fromPage: true })
  // gets a back button to it; any other page starts afresh.
  function showPage(page, { fromPage = false } = {}) {
    if (fromPage && view) backStack.push({ view, fish: speciesFilter });
    else if (!fromPage) backStack.length = 0;
    view = page;
    setSelected(page.type === 'water' ? page.id : null);
    el.hint.hidden = true;
    el.panel.hidden = false;
    renderPanel();
    el.panelContent.scrollTop = 0;
    document.getElementById('panel-title')?.focus({ preventScroll: true });
  }

  function goBack() {
    const previous = backStack.pop();
    if (!previous) return;
    view = previous.view;
    highlightFish(previous.fish);
    setSelected(view.type === 'water' ? view.id : null);
    renderPanel();
    el.panelContent.scrollTop = 0;
    document.getElementById('panel-title')?.focus({ preventScroll: true });
  }

  // Moves the map so the tapped spot is not hidden behind the info panel:
  // above the panel on phones, to the left of it on bigger screens.
  function keepVisible(latlng) {
    const mapBox = el.map.getBoundingClientRect();
    const panelBox = el.panel.getBoundingClientRect();
    const point = map.latLngToContainerPoint(latlng);
    const panelLeft = panelBox.left - mapBox.left;
    const panelTop = panelBox.top - mapBox.top;
    const margin = 32;
    const isSheet = panelBox.width >= mapBox.width - 1; // phone: panel spans the width

    if (isSheet && point.y > panelTop - margin) {
      map.panBy([0, point.y - panelTop / 2]);
    } else if (!isSheet && point.x > panelLeft - margin && point.y > panelTop - margin) {
      map.panBy([point.x - panelLeft / 2, 0]);
    }
  }

  function closePanel() {
    if (!view) return;
    view = null;
    backStack.length = 0;
    setSelected(null);
    el.panel.hidden = true;
    highlightFish(chosenFish);
  }

  el.panelClose.addEventListener('click', closePanel);
  map.on('click', () => {
    closeCityName();
    closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  function renderPanel() {
    if (!view) return;
    const box = el.panelContent;
    box.replaceChildren();
    if (backStack.length) {
      const back = add(box, 'button', { className: 'panel-back' });
      back.type = 'button';
      back.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
        + '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" '
        + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
      add(back, 'span', { text: t('back') });
      back.addEventListener('click', goBack);
    }
    if (view.type === 'fish') renderFishPage(box, view.latin);
    else renderWaterPage(box, view.id);
  }

  function renderWaterPage(box, id) {
    const layer = layersById.get(id);
    if (!layer) return;
    const props = layer.feature.properties;
    const info = waters[props.id];

    const title = add(box, 'h2', { id: 'panel-title', text: displayName(props) });
    title.tabIndex = -1;

    const kind = add(box, 'p', { className: 'kind' });
    add(kind, 'span', { className: `swatch swatch--${props.type === 'river' ? 'river' : 'lake'}` });
    kind.append(t(props.type));

    const altName = otherName(props);
    if (altName) add(box, 'p', { className: 'alt-name', text: altName });

    if (watersError) {
      add(box, 'p', { className: 'note note--error', text: t('watersLoadError') });
      return;
    }
    if (info?.description) add(box, 'p', { className: 'description', text: pick(info.description) });
    if (info?.placeholder) add(box, 'p', { className: 'note', text: t('placeholder') });

    const shown = info ? renderInfo(box, info) + (info.description ? 1 : 0) : 0;
    if (!shown) add(box, 'p', { className: 'no-info', text: t('noInfo') });
    if (info) renderSources(box, info);
  }

  // A fish's page: picture, names, how to catch it, baits, fun facts, and the
  // waters on the map where it lives.
  function renderFishPage(box, latin) {
    const entry = species.get(latin) || { latin, names: new Set(), waters: new Set() };
    const page = fishPages[latin] || {};
    const name = fishName(entry);

    const title = add(box, 'h2', { id: 'panel-title', text: name });
    title.tabIndex = -1;

    const kind = add(box, 'p', { className: 'kind' });
    add(kind, 'span', { className: 'swatch swatch--fish' });
    if (name !== latin) add(kind, 'i', { text: latin });
    else kind.append(t('typeFish'));

    const other = lang === 'en' ? page.mk || entry.mk : page.en || entry.en;
    if (other && other !== name) add(box, 'p', { className: 'alt-name', text: other });

    renderFishPicture(box, latin, name);

    if (fishError) add(box, 'p', { className: 'note note--error', text: t('fishLoadError') });

    let shown = 0;
    for (const key of ['tips', 'baits', 'funFacts']) {
      const items = asList(page[key]);
      if (!items.length) continue;
      shown++;
      const s = addSection(box, `fish_${key}`);
      addTextList(s, items);
    }
    if (!shown && !fishError) add(box, 'p', { className: 'no-info', text: t('fishNoInfo') });

    // The waters on the map where this fish lives (according to waters.json).
    const ids = [...entry.waters].filter((id) => layersById.has(id));
    if (ids.length) {
      const s = addSection(box, 'fishWaters');
      const ul = add(s, 'ul', { className: 'water-list' });
      const nameOf = (id) => displayName(layersById.get(id).feature.properties);
      for (const id of ids.sort((a, b) => nameOf(a).localeCompare(nameOf(b), lang))) {
        const type = layersById.get(id).feature.properties.type;
        const button = add(add(ul, 'li'), 'button', { className: 'water-link' });
        button.type = 'button';
        add(button, 'span', { className: `swatch swatch--${type === 'river' ? 'river' : 'lake'} swatch--fish-water` });
        add(button, 'span', { className: 'water-link-name', text: nameOf(id) });
        add(button, 'span', { className: 'water-link-kind', text: t(type) });
        button.addEventListener('click', () => openWater(id));
      }
    }
    renderSources(box, page);
  }

  // The fish's picture from Wikimedia Commons, with the author and licence under it.
  function renderFishPicture(box, latin, name) {
    const pic = fishImages[latin];
    if (!pic?.src) return;
    const figure = add(box, 'figure', { className: 'fish-photo' });
    const img = add(figure, 'img');
    img.alt = name;
    img.decoding = 'async';
    if (pic.width && pic.height) {
      img.width = pic.width;
      img.height = pic.height;
    }
    img.addEventListener('error', () => figure.remove());
    img.src = pic.src;
    const caption = add(figure, 'figcaption');
    caption.append(`${t('photo')}: ${pic.author || t('unknownAuthor')}`);
    if (pic.licence) {
      caption.append(' · ');
      if (pic.licenceUrl) addLink(caption, pic.licence, pic.licenceUrl);
      else caption.append(pic.licence);
    }
    caption.append(' · ');
    if (pic.page) addLink(caption, 'Wikimedia Commons', pic.page);
    else caption.append('Wikimedia Commons');
  }

  // Fish name in the current language. English falls back to the Latin name
  // (not to Cyrillic), Macedonian falls back to the Latin name too.
  // data/fish.json can give a name that waters.json doesn't have.
  function fishName(fish) {
    const page = fishPages[fish.latin] || {};
    return (lang === 'en' ? page.en || fish.en : page.mk || fish.mk) || fish.latin;
  }

  // Biggest species first (by maximum length); species without a size keep their
  // order from waters.json, after the others.
  function biggestFirst(list) {
    const size = (item) => (item && typeof item === 'object' && Number(fishSizes[item.latin])) || 0;
    return list
      .map((item, index) => ({ item, index }))
      .sort((a, b) => size(b.item) - size(a.item) || a.index - b.index)
      .map(({ item }) => item);
  }

  // One fish in a water's list: its name in the current language, the Latin name
  // and tags such as "endemic" (only when waters.json says so). Tapping it opens
  // the fish's page.
  function renderFishItem(list, item) {
    const li = add(list, 'li');
    if (item && typeof item === 'object' && item.latin) {
      const button = add(li, 'button', { className: 'fish-link' });
      button.type = 'button';
      const name = fishName(item);
      add(button, 'span', { className: 'fish-name', text: name });
      if (name !== item.latin) add(button, 'i', { className: 'fish-latin', text: item.latin });
      if (item.endemic) add(button, 'span', { className: 'tag', text: t('endemic') });
      if (item.introduced) add(button, 'span', { className: 'tag tag--introduced', text: t('introduced') });
      button.insertAdjacentHTML('beforeend', '<svg class="fish-link-arrow" viewBox="0 0 24 24" width="16" height="16" '
        + 'aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" '
        + 'stroke-linecap="round" stroke-linejoin="round"/></svg>');
      button.addEventListener('click', () => openFish(item.latin));
      if (item.latin === speciesFilter) li.classList.add('is-match');
    } else {
      add(li, 'span', { className: 'fish-name', text: pick(item) });
    }
  }

  function renderSources(box, info) {
    const sources = asList(info.sources);
    if (!sources.length) return;
    const s = add(box, 'section', { className: 'info-section sources' });
    add(s, 'h3', { text: t('sources') });
    const ul = add(s, 'ul');
    for (const source of sources) {
      const li = add(ul, 'li');
      const title = pick(source.title) || source.url;
      if (source.url) addLink(li, title, source.url);
      else li.textContent = title;
    }
  }

  function addSection(box, key) {
    const s = add(box, 'section', { className: 'info-section' });
    add(s, 'h3', { text: t(key) });
    return s;
  }

  // One text as a paragraph, several as a list.
  function addTextList(section, items) {
    if (items.length === 1) {
      add(section, 'p', { text: pick(items[0]) });
      return;
    }
    const ul = add(section, 'ul');
    for (const item of items) add(ul, 'li', { text: pick(item) });
  }

  // Adds one section per filled-in field. Returns how many sections were added.
  function renderInfo(box, info) {
    let count = 0;
    for (const key of ['fish', 'permits', 'closedSeasons', 'catchLimits', 'minimumSizes',
      'protectedSpecies', 'noFishingZones', 'notes']) {
      const items = asList(info[key]);
      if (!items.length) continue;
      count++;
      const s = addSection(box, key);

      if (key === 'fish') {
        const ul = add(s, 'ul', { className: 'fish-list' });
        for (const item of biggestFirst(items)) renderFishItem(ul, item);
        if (info.fishNote) add(s, 'p', { className: 'section-note', text: pick(info.fishNote) });
      } else if (key === 'permits') {
        for (const permit of items) {
          const dl = add(s, 'dl', { className: 'permit' });
          for (const field of ['issuer', 'contact', 'price']) {
            const value = pick(permit[field]);
            if (!value) continue;
            add(dl, 'dt', { text: t(field) });
            add(dl, 'dd', { text: value });
          }
        }
      } else if (key === 'minimumSizes') {
        const dl = add(s, 'dl', { className: 'sizes' });
        for (const item of items) {
          if (item && typeof item === 'object' && 'fish' in item) {
            add(dl, 'dt', { text: pick(item.fish) });
            add(dl, 'dd', { text: pick(item.size) });
          } else {
            add(dl, 'dd', { text: pick(item) });
          }
        }
      } else {
        addTextList(s, items);
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Search (top of the page): municipalities, cities, rivers, lakes and fish
  // ---------------------------------------------------------------------------

  function buildSearch() {
    el.searchInput.addEventListener('input', () => {
      searchChoice = null;
      updateSearch();
    });
    el.searchInput.addEventListener('focus', () => {
      if (el.searchInput.value.trim() && !searchChoice) updateSearch();
    });
    el.searchInput.addEventListener('blur', closeSuggestions);
    el.searchInput.addEventListener('keydown', onSearchKey);
    // Keep the focus in the box while a suggestion is clicked.
    el.searchList.addEventListener('mousedown', (e) => e.preventDefault());
    el.searchList.addEventListener('click', (e) => {
      const option = e.target.closest('[data-index]');
      if (option) chooseResult(Number(option.dataset.index));
    });
    el.searchClear.addEventListener('mousedown', (e) => e.preventDefault());
    el.searchClear.addEventListener('click', () => {
      clearSearch();
      el.searchInput.focus();
    });
  }

  function onSearchKey(e) {
    const open = !el.searchList.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return updateSearch();
      if (!searchResults.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      searchActive = (searchActive + step + searchResults.length) % searchResults.length;
      renderSuggestions();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) updateSearch();
      if (searchResults.length) chooseResult(Math.max(0, searchActive));
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // don't close the panel too
      if (open) closeSuggestions();
      else if (el.searchInput.value) clearSearch();
      else el.searchInput.blur();
    }
  }

  function updateSearch() {
    const query = searchFold(el.searchInput.value);
    el.searchClear.hidden = !el.searchInput.value;
    if (!query) {
      searchResults = [];
      closeSuggestions();
      return;
    }
    searchResults = findResults(query);
    searchActive = searchResults.length ? 0 : -1;
    renderSuggestions();
  }

  // Best matches first; equally good ones in SEARCH_ORDER, then bigger/more common first.
  function findResults(query) {
    const found = [];
    for (const entry of getSearchIndex()) {
      let score = 0;
      for (const name of entry.names) score = Math.max(score, searchScore(name, query));
      if (score) found.push({ entry, score });
    }
    found.sort((a, b) => b.score - a.score
      || SEARCH_ORDER.indexOf(a.entry.type) - SEARCH_ORDER.indexOf(b.entry.type)
      || b.entry.weight - a.entry.weight
      || a.entry.label().localeCompare(b.entry.label(), lang));
    return found.slice(0, SEARCH_MAX).map((r) => r.entry);
  }

  function renderSuggestions() {
    const list = el.searchList;
    list.replaceChildren();
    if (!searchResults.length) {
      add(list, 'li', { className: 'search-empty', text: t('searchNoResults') });
      el.searchInput.removeAttribute('aria-activedescendant');
    }
    searchResults.forEach((entry, i) => {
      const li = add(list, 'li', { className: 'search-option', id: `search-option-${i}` });
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === searchActive));
      li.dataset.index = i;
      add(li, 'span', { className: `search-icon search-icon--${entry.type}` });
      const text = add(li, 'span', { className: 'search-text' });
      add(text, 'span', { className: 'search-name', text: entry.label() });
      const meta = add(text, 'span', { className: 'search-meta', text: entry.meta() });
      if (entry.latin && entry.label() !== entry.latin) add(meta, 'i', { text: entry.latin });
    });
    if (searchActive >= 0) {
      el.searchInput.setAttribute('aria-activedescendant', `search-option-${searchActive}`);
      document.getElementById(`search-option-${searchActive}`)?.scrollIntoView({ block: 'nearest' });
    }
    list.hidden = false;
    el.searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeSuggestions() {
    el.searchList.hidden = true;
    el.searchInput.setAttribute('aria-expanded', 'false');
    el.searchInput.removeAttribute('aria-activedescendant');
  }

  function chooseResult(index) {
    const entry = searchResults[index];
    if (!entry) return;
    searchChoice = entry;
    el.searchInput.value = entry.label();
    el.searchClear.hidden = false;
    closeSuggestions();
    el.searchInput.blur(); // also hides the keyboard on phones
    entry.go();
  }

  // Empties the box and undoes what the chosen result did (fish in red, municipality).
  function clearSearch() {
    const choice = searchChoice;
    clearSearchText();
    if (choice?.type === 'fish' && chosenFish === choice.latin) {
      highlightFish(null, { chosen: true });
      if (view) renderPanel();
    }
    if (choice?.type === 'municipality' && municipalityId === choice.id) clearMunicipality();
  }

  function clearSearchText() {
    searchChoice = null;
    searchResults = [];
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    closeSuggestions();
  }

  // Everything the search can find. Each entry has the names to match (in plain
  // Latin letters, all languages), a label and a short description in the current
  // language, and what to do when it is chosen.
  function getSearchIndex() {
    if (searchIndex) return searchIndex;
    const index = [];
    const names = (...list) => [...new Set(list.filter(Boolean).map(searchFold))];
    const municipalityNames = new Set();

    for (const f of municipalities.values()) {
      const p = f.properties;
      municipalityNames.add(searchFold(p.name));
      index.push({
        type: 'municipality', id: p.id, weight: 0,
        names: names(p.name, p['name:en']),
        label: () => municipalityName(p),
        meta: () => t('typeMunicipality'),
        go: () => {
          showLayer('municipalities');
          showMunicipality(p.id);
        },
      });
    }

    // Cities with the same name as their municipality are found as the municipality.
    for (const layer of cityLayers) {
      const p = layer.feature.properties;
      if (municipalityNames.has(searchFold(p.name))) continue;
      index.push({
        type: 'city', id: p.id, weight: p.population || 0,
        names: names(p.name, p['name:en']),
        label: () => displayName(p),
        meta: () => t('typeCity'),
        go: () => {
          showLayer('cities');
          fitArea(layer.getBounds());
          map.once('moveend', () => showCityName(layer.feature, layer.getBounds().getCenter()));
        },
      });
    }

    // Waters. Rivers and lakes that share a name also show their municipality.
    const count = new Map();
    for (const layer of layersById.values()) {
      const key = searchFold(layer.feature.properties.name);
      count.set(key, (count.get(key) || 0) + 1);
    }
    for (const [id, layer] of layersById) {
      const p = layer.feature.properties;
      const place = count.get(searchFold(p.name)) > 1 ? municipalityAt(middlePoint(layer.feature.geometry)) : null;
      index.push({
        type: p.type, id, weight: p.lengthKm || 0,
        names: names(p.name, p['name:en']),
        label: () => displayName(p),
        meta: () => (place ? `${t(p.type)} · ${municipalityName(place.properties)}` : t(p.type)),
        go: () => {
          showLayer(groupOf(layer.feature));
          select(id);
          fitArea(layer.getBounds());
        },
      });
    }

    for (const entry of species.values()) {
      const page = fishPages[entry.latin] || {};
      index.push({
        type: 'fish', latin: entry.latin, weight: entry.waters.size,
        names: names(entry.latin, page.mk, page.en, ...entry.names, ...asList(page.otherNames)),
        label: () => fishName(entry),
        meta: () => t('typeFish'),
        go: () => showFishFromSearch(entry),
      });
    }
    searchIndex = index;
    return index;
  }

  // A fish chosen in the search: its page, its waters in red, all of them on screen.
  function showFishFromSearch(entry) {
    highlightFish(entry.latin, { chosen: true });
    showPage({ type: 'fish', latin: entry.latin });
    const bounds = L.latLngBounds([]);
    for (const id of entry.waters) {
      const layer = layersById.get(id);
      if (!layer) continue;
      showLayer(groupOf(layer.feature));
      bounds.extend(layer.getBounds());
    }
    fitArea(bounds);
  }

  // ---------------------------------------------------------------------------
  // Language
  // ---------------------------------------------------------------------------

  function t(key) {
    return TEXT[lang][key] ?? TEXT[DEFAULT_LANG][key] ?? key;
  }

  // A text in waters.json can be "plain text" or { "mk": "…", "en": "…" }.
  function pick(value) {
    if (value == null) return '';
    if (typeof value !== 'object') return String(value);
    return value[lang] || value[DEFAULT_LANG] || Object.values(value)[0] || '';
  }

  function displayName(props) {
    return lang === 'en' ? props['name:en'] || props.name : props.name;
  }

  function otherName(props) {
    if (!props['name:en'] || props['name:en'] === props.name) return null;
    return lang === 'en' ? props.name : props['name:en'];
  }

  function loadLanguage() {
    try {
      const saved = localStorage.getItem('lang');
      if (LANGUAGES.includes(saved)) return saved;
    } catch (e) { /* storage not available: use the default */ }
    return DEFAULT_LANG;
  }

  function setLanguage(next) {
    lang = next;
    try { localStorage.setItem('lang', next); } catch (e) { /* ignore */ }
    applyTexts();
    closeCityName();
    if (view) renderPanel();
  }

  el.langSwitch.addEventListener('click', () => {
    const next = LANGUAGES[(LANGUAGES.indexOf(lang) + 1) % LANGUAGES.length];
    setLanguage(next);
  });

  function applyTexts() {
    document.documentElement.lang = lang;
    document.title = t('pageTitle');
    el.title.textContent = t('siteTitle');
    el.subtitle.textContent = t('siteSubtitle');
    el.langSwitch.textContent = t('switchLanguage');
    el.langSwitch.setAttribute('aria-label', t('switchLanguageLabel'));
    el.searchLabel.textContent = t('search');
    el.searchInput.placeholder = t(PHONE.matches ? 'searchPlaceholderShort' : 'searchPlaceholder');
    el.searchClear.setAttribute('aria-label', t('searchClear'));
    el.searchList.setAttribute('aria-label', t('searchResults'));
    if (searchChoice) el.searchInput.value = searchChoice.label();
    if (!el.searchList.hidden) renderSuggestions();
    el.map.setAttribute('aria-label', t('mapLabel'));
    el.filterLabel.textContent = t('filter');
    el.filterList.setAttribute('aria-label', t('filterLabel'));
    for (const span of el.filterList.querySelectorAll('[data-text]')) span.textContent = t(span.dataset.text);
    fillSpeciesOptions();
    fillMunicipalityOptions();
    const zoom = zoomControl.getContainer();
    zoom.querySelector('.leaflet-control-zoom-in').title = t('zoomIn');
    zoom.querySelector('.leaflet-control-zoom-out').title = t('zoomOut');
    el.hint.textContent = t('hint');
    el.panelClose.setAttribute('aria-label', t('close'));
    if (messageKey) el.message.textContent = t(messageKey);
  }

  PHONE.addEventListener('change', () => {
    el.searchInput.placeholder = t(PHONE.matches ? 'searchPlaceholderShort' : 'searchPlaceholder');
  });

  function showMessage(key) {
    messageKey = key;
    el.message.textContent = t(key);
    el.message.hidden = false;
    el.hint.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // The polygons of a Polygon or MultiPolygon, as a list of [outer ring, holes...].
  function polygonsOf(geometry) {
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }

  // A point on a water: the middle of its longest line, or a point on a lake's shore.
  function middlePoint(geometry) {
    const lines = geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.type === 'MultiLineString' ? geometry.coordinates
        : polygonsOf(geometry).map((polygon) => polygon[0]);
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), []);
    return longest[Math.floor(longest.length / 2)];
  }

  // The municipality that contains a point [lon, lat], or null.
  function municipalityAt(point) {
    if (!point) return null;
    const [x, y] = point;
    for (const f of municipalities.values()) {
      for (const rings of polygonsOf(f.geometry)) {
        let inside = false;
        for (const ring of rings) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          }
        }
        if (inside) return f;
      }
    }
    return null;
  }

  function getJSON(url) {
    return fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    });
  }

  // Creates an element, sets its text/class/id and appends it to parent.
  function add(parent, tag, { text, className, id } = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    if (id) node.id = id;
    parent.append(node);
    return node;
  }

  // A link that opens in a new tab.
  function addLink(parent, text, url) {
    const a = add(parent, 'a', { text });
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  // Turns a value from the JSON files into a list (missing/empty values become []).
  function asList(value) {
    if (value == null || value === '') return [];
    return (Array.isArray(value) ? value : [value]).filter((v) => v != null && v !== '');
  }

  function lengthKm(geometry) {
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    let metres = 0;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        metres += map.distance(L.latLng(line[i - 1][1], line[i - 1][0]), L.latLng(line[i][1], line[i][0]));
      }
    }
    return metres / 1000;
  }
})();
