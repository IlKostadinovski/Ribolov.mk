// RibolovMK – the map and the info panel.
//
// Data it reads (all relative paths, so it works on GitHub Pages):
//   data/map/border.geojson, rivers.geojson, lakes.geojson   generated, see scripts/
//   data/waters.json                                        fishing info, edited by hand
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
    waters: 'data/waters.json',
  };

  // Map colours, read from the --map-* variables in css/style.css.
  const rootStyle = getComputedStyle(document.documentElement);
  const cssVar = (name) => rootStyle.getPropertyValue(name).trim();
  const COLORS = {
    land: cssVar('--map-land'),
    border: cssVar('--map-border'),
    water: cssVar('--map-water'),
    waterHover: cssVar('--map-water-hover'),
    lake: cssVar('--map-lake'),
    lakeHover: cssVar('--map-lake-hover'),
    selected: cssVar('--map-selected'),
  };

  // Tap/click areas, in screen pixels. Every river also gets an invisible line
  // RIVER_TAP_WIDTH wide, so thin rivers are easy to hit with a finger.
  // TAP_TOLERANCE is a small extra margin around every shape.
  const RIVER_TAP_WIDTH = L.Browser.touch ? 18 : 8;
  const TAP_TOLERANCE = L.Browser.touch ? 6 : 3;

  // Show the water's name next to the mouse (only on devices that can hover).
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
  const layersById = new Map(); // water id -> visible map layer

  const el = {
    title: document.getElementById('site-title'),
    subtitle: document.getElementById('site-subtitle'),
    langSwitch: document.getElementById('lang-switch'),
    map: document.getElementById('map'),
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
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
  });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  map.attributionControl.addAttribution(
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  );

  applyTexts();

  Promise.all([getJSON(FILES.border), getJSON(FILES.lakes), getJSON(FILES.rivers)])
    .then(([border, lakes, rivers]) => drawMap(border, lakes, rivers))
    .catch((err) => {
      console.error(err);
      showMessage('mapLoadError');
    });

  getJSON(FILES.waters)
    .then((data) => { waters = data || {}; })
    .catch((err) => {
      console.error('data/waters.json:', err);
      watersError = true;
    })
    .finally(() => { if (selectedId) renderPanel(); });

  function drawMap(border, lakes, rivers) {
    // The border layer also fills the country with the land colour.
    const borderLayer = L.geoJSON(border, {
      interactive: false,
      style: {
        color: COLORS.border,
        weight: 1.5,
        dashArray: '12 4 2 4', // dash-dot, the usual map symbol for a state border
        fillColor: COLORS.land,
        fillOpacity: 1,
      },
    });

    // Set the view before adding layers (Leaflet only draws on a map that has a view).
    const bounds = borderLayer.getBounds();
    map.fitBounds(bounds, { padding: [8, 8] });
    map.setMinZoom(map.getZoom() - 1);
    map.setMaxBounds(bounds.pad(2)); // keeps the country in reach, with room for the panel

    for (const f of rivers.features) f.properties.lengthKm = lengthKm(f.geometry);

    // Drawing order, bottom to top: border, river lines, invisible river tap
    // lines, lakes. Lakes are on top, so a tap inside a lake always picks the lake.
    const remember = (f, layer) => layersById.set(f.properties.id, layer);
    borderLayer.addTo(map);
    L.geoJSON(rivers, { style: waterStyle, interactive: false, onEachFeature: remember }).addTo(map);
    L.geoJSON(rivers, {
      style: { weight: RIVER_TAP_WIDTH, opacity: 0, lineCap: 'round', lineJoin: 'round' },
      onEachFeature: listenForTaps,
    }).addTo(map);
    L.geoJSON(lakes, {
      style: waterStyle,
      onEachFeature: (f, layer) => { remember(f, layer); listenForTaps(f, layer); },
    }).addTo(map);
    map.on('zoomend', restyleAll);
  }

  // Clicks, taps and hover on a water's tap area (for lakes, the lake itself).
  function listenForTaps(feature, layer) {
    const id = feature.properties.id;
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      select(id, e.latlng);
    });
    layer.on('mouseover', () => setHovered(id));
    layer.on('mouseout', () => setHovered(null));
    if (CAN_HOVER) {
      layer.bindTooltip(() => displayName(feature.properties), {
        sticky: true,
        direction: 'top',
        offset: [0, -10],
        className: 'water-tooltip',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Styles: normal, hover and selected
  // ---------------------------------------------------------------------------

  function waterStyle(feature) {
    const { id, type } = feature.properties;
    const state = id === selectedId ? 'selected' : id === hoveredId ? 'hover' : 'normal';
    const lineColor = { normal: COLORS.water, hover: COLORS.waterHover, selected: COLORS.selected }[state];

    if (type === 'river') {
      const width = riverWidth(feature.properties.lengthKm) * zoomFactor();
      return {
        color: lineColor,
        weight: state === 'normal' ? width : width + 2,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      };
    }
    return {
      color: lineColor,
      weight: state === 'normal' ? 1 : 2.5,
      opacity: 1,
      fillColor: state === 'hover' ? COLORS.lakeHover : COLORS.lake,
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
  map.on('click', closePanel);
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
    if (info?.placeholder) add(box, 'p', { className: 'note', text: t('placeholder') });

    const shown = info ? renderInfo(box, info) : 0;
    if (!shown) add(box, 'p', { className: 'no-info', text: t('noInfo') });
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

      if (key === 'permits') {
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
