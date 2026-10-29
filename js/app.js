// RibolovMK – the map, the filter and the info panel.
//
// Data it reads (all relative paths, so it works on GitHub Pages):
//   data/map/*.geojson   border, rivers, lakes, municipalities, cities (generated, see scripts/)
//   data/waters.json     fishing info, edited by hand
// All visible text comes from js/i18n.js. Colours come from css/style.css.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  const FILES = {
    border: 'data/map/border.geojson',
    rivers: 'data/map/rivers.geojson',
    lakes: 'data/map/lakes.geojson',
    municipalities: 'data/map/municipalities.geojson',
    cities: 'data/map/cities.geojson',
    waters: 'data/waters.json',
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
  };

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

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let lang = loadLanguage();
  let waters = {};              // contents of data/waters.json
  let watersError = false;      // true if data/waters.json could not be read
  let messageKey = null;        // error message currently shown, if any
  let selectedId = null;
  let hoveredId = null;
  let cityLabel = null;         // city name shown after a tap (phones)
  let speciesFilter = null;     // Latin name of the fish chosen in the filter, or null
  const species = new Map();    // Latin name -> { latin, mk, en, waters: Set of water ids }
  const layersById = new Map(); // water id -> visible map layer
  const groups = {};            // filter name -> map layer group
  const visible = Object.fromEntries(FILTERS.map((key) => [key, true]));

  const el = {
    title: document.getElementById('site-title'),
    subtitle: document.getElementById('site-subtitle'),
    langSwitch: document.getElementById('lang-switch'),
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
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  map.attributionControl.addAttribution(
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  );

  buildFilter();
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
    });

  getJSON(FILES.waters)
    .then((data) => {
      waters = data || {};
      buildSpeciesFilter();
    })
    .catch((err) => {
      console.error('data/waters.json:', err);
      watersError = true;
    })
    .finally(() => { if (selectedId) renderPanel(); });

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
    groups.municipalities = L.geoJSON(data.municipalities, {
      interactive: false,
      style: { color: COLORS.municipality, weight: 0.8, opacity: 0.4, dashArray: '4 4' },
    });
    groups.cities = L.geoJSON(data.cities, {
      style: { stroke: false, fillColor: COLORS.city, fillOpacity: 0.9 },
      onEachFeature: setUpCity,
    });

    borderLayer.addTo(map);
    applyFilters();
    map.on('zoomend', restyleAll);
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
    if (CAN_HOVER) {
      layer.bindTooltip(() => displayName(feature.properties), { ...CITY_LABEL, sticky: true });
    }
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (CAN_HOVER) return;
      closeCityName();
      cityLabel = L.tooltip(CITY_LABEL)
        .setLatLng(e.latlng)
        .setContent(displayName(feature.properties))
        .addTo(map);
    });
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
      add(item, 'span', { className: `legend legend--${key}` });
      add(item, 'span', { className: 'filter-text' }).dataset.text = key;
    }
    el.filterToggle.addEventListener('click', () => {
      const open = el.filterList.hidden;
      el.filterList.hidden = !open;
      el.filterToggle.setAttribute('aria-expanded', String(open));
    });
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

  function groupOf(feature) {
    return { river: 'rivers', lake: 'lakes', reservoir: 'reservoirs' }[feature.properties.type];
  }

  // Fish filter: lists every species named in data/waters.json (by Latin name).
  // Choosing one draws the waters without it faintly.
  function buildSpeciesFilter() {
    species.clear();
    for (const [id, info] of Object.entries(waters)) {
      for (const fish of asList(info?.fish)) {
        if (!fish || typeof fish !== 'object' || !fish.latin) continue;
        const entry = species.get(fish.latin) || { latin: fish.latin, waters: new Set() };
        entry.mk = entry.mk || fish.mk;
        entry.en = entry.en || fish.en;
        entry.waters.add(id);
        species.set(fish.latin, entry);
      }
    }
    if (!species.size) return;

    const box = add(el.filterList, 'div', { className: 'filter-species' });
    const label = add(box, 'label', { className: 'filter-species-label' });
    label.htmlFor = 'species-select';
    label.dataset.text = 'fishFilter';
    label.textContent = t('fishFilter');
    const select = add(box, 'select', { id: 'species-select' });
    add(box, 'p', { className: 'filter-hint', id: 'species-count' });
    select.addEventListener('change', () => {
      speciesFilter = select.value || null;
      restyleAll();
      updateSpeciesCount();
      if (selectedId) renderPanel();
    });
    fillSpeciesOptions();
  }

  // (Re)writes the fish list in the current language, sorted by name.
  function fillSpeciesOptions() {
    const select = document.getElementById('species-select');
    if (!select) return;
    const nameOf = (entry) => (lang === 'en' ? entry.en : entry.mk) || entry.mk || entry.en || entry.latin;
    select.replaceChildren();
    add(select, 'option', { text: t('allSpecies') }).value = '';
    const sorted = [...species.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b), lang));
    for (const entry of sorted) {
      const name = nameOf(entry);
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

  // ---------------------------------------------------------------------------
  // Styles: normal, hover and selected
  // ---------------------------------------------------------------------------

  function waterStyle(feature) {
    const { id, type } = feature.properties;
    const state = id === selectedId ? 'selected' : id === hoveredId ? 'hover' : 'normal';
    // With a fish chosen in the filter, waters without it are drawn faintly.
    const faint = state === 'normal' && speciesFilter && !species.get(speciesFilter)?.waters.has(id);
    const lineColor = { normal: COLORS.water, hover: COLORS.waterHover, selected: COLORS.selected }[state];

    if (type === 'river') {
      const width = riverWidth(feature.properties.lengthKm) * zoomFactor();
      return {
        color: lineColor,
        weight: state === 'normal' ? width : width + 2,
        opacity: faint ? 0.18 : 1,
        lineCap: 'round',
        lineJoin: 'round',
      };
    }
    return {
      color: lineColor,
      weight: state === 'normal' ? 1 : 2.5,
      opacity: faint ? 0.25 : 1,
      fillColor: state === 'hover' ? COLORS.lakeHover : type === 'reservoir' ? COLORS.reservoir : COLORS.lake,
      fillOpacity: faint ? 0.25 : 1,
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

  // ---------------------------------------------------------------------------
  // Selecting a water and the info panel
  // ---------------------------------------------------------------------------

  function select(id, latlng) {
    const previous = selectedId;
    selectedId = id;
    restyle(previous);
    restyle(id);
    layersById.get(id)?.bringToFront();
    el.hint.hidden = true;
    renderPanel();
    el.panel.hidden = false;
    el.panelContent.scrollTop = 0;
    document.getElementById('panel-title')?.focus({ preventScroll: true });
    if (latlng) keepVisible(latlng);
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
    if (!selectedId) return;
    const previous = selectedId;
    selectedId = null;
    restyle(previous);
    el.panel.hidden = true;
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
    const layer = layersById.get(selectedId);
    if (!layer) return;
    const props = layer.feature.properties;
    const info = waters[props.id];
    const box = el.panelContent;
    box.replaceChildren();

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

  // One fish in the list: its name in the current language, the Latin name, and
  // tags such as "endemic" (only when waters.json says so).
  function renderFish(list, item) {
    const li = add(list, 'li');
    if (item && typeof item === 'object' && item.latin) {
      const name = (lang === 'en' ? item.en : item.mk) || item.mk || item.en || item.latin;
      add(li, 'span', { className: 'fish-name', text: name });
      if (name !== item.latin) add(li, 'i', { className: 'fish-latin', text: item.latin });
      if (item.endemic) add(li, 'span', { className: 'tag', text: t('endemic') });
      if (item.introduced) add(li, 'span', { className: 'tag tag--introduced', text: t('introduced') });
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
      if (source.url) {
        const a = add(li, 'a', { text: title });
        a.href = source.url;
        a.target = '_blank';
        a.rel = 'noopener';
      } else {
        li.textContent = title;
      }
    }
  }

  // Adds one section per filled-in field. Returns how many sections were added.
  function renderInfo(box, info) {
    let count = 0;
    const section = (key) => {
      count++;
      const s = add(box, 'section', { className: 'info-section' });
      add(s, 'h3', { text: t(key) });
      return s;
    };

    for (const key of ['fish', 'permits', 'closedSeasons', 'catchLimits', 'minimumSizes',
      'protectedSpecies', 'noFishingZones', 'notes']) {
      const items = asList(info[key]);
      if (!items.length) continue;
      const s = section(key);

      if (key === 'fish') {
        const ul = add(s, 'ul', { className: 'fish-list' });
        for (const item of items) renderFish(ul, item);
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
      } else if (items.length === 1) {
        add(s, 'p', { text: pick(items[0]) });
      } else {
        const ul = add(s, 'ul');
        for (const item of items) add(ul, 'li', { text: pick(item) });
      }
    }
    return count;
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
    if (selectedId) renderPanel();
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
    el.map.setAttribute('aria-label', t('mapLabel'));
    el.filterLabel.textContent = t('filter');
    el.filterList.setAttribute('aria-label', t('filterLabel'));
    for (const span of el.filterList.querySelectorAll('[data-text]')) span.textContent = t(span.dataset.text);
    fillSpeciesOptions();
    const zoom = zoomControl.getContainer();
    zoom.querySelector('.leaflet-control-zoom-in').title = t('zoomIn');
    zoom.querySelector('.leaflet-control-zoom-out').title = t('zoomOut');
    el.hint.textContent = t('hint');
    el.panelClose.setAttribute('aria-label', t('close'));
    if (messageKey) el.message.textContent = t(messageKey);
  }

  function showMessage(key) {
    messageKey = key;
    el.message.textContent = t(key);
    el.message.hidden = false;
    el.hint.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

  // Turns a value from waters.json into a list (missing/empty values become []).
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
