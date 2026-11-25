/* Ostheim v.d.Rhön – interaktive Karte
 * Abhängigkeiten: MapLibre GL JS (BSD-3), optional Pannellum (MIT) für 360°-Panoramen.
 * Daten: data/pois.geojson, data/routes.geojson, data/inhalte.json
 *
 * Einbindung / Deep-Links:
 *   index.html#ort=kirchenburg-ostheim   → öffnet einen Ort
 *   index.html#weg=r6132505              → öffnet einen Weg
 *   index.html?embed=1                   → ohne Titel (für iframe in Stadt-Website/App)
 *   index.html?kat=Restaurant/Gasthaus,Café/Eis → nur diese Kategorien
 *   window.postMessage({type:"ostheim-karte", ort:"<id>"}) aus der umgebenden Seite/App
 */
(() => {
  "use strict";
  const C = window.KARTE_CONFIG;
  const params = new URLSearchParams(location.search);
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isDesktop = () => matchMedia("(min-width: 900px)").matches;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (params.get("embed")) document.body.classList.add("embed");
  $("#titel").textContent = C.titel;
  $("#untertitel").textContent = C.untertitel;
  document.title = C.titel;

  const katOrder = Object.keys(C.kategorien);
  const startKat = params.get("kat") ? params.get("kat").split(",") : katOrder.filter((k) => !C.startAusgeblendet.includes(k));
  const state = {
    pois: [], routes: [], inhalte: {},
    aktiv: new Set(startKat), wege: !params.get("kat"),
    suche: "", tab: "orte", auswahl: null,
    is3d: !params.get("flach") && !reduceMotion, luftbild: false, tour: null,
  };

  // ------------------------------------------------------------------ Karte
  const map = new maplibregl.Map({
    container: "map",
    style: C.stilKarte,
    center: C.start.center,
    zoom: C.start.zoom,
    pitch: state.is3d ? C.start.pitch : 0,
    bearing: state.is3d ? C.start.bearing : 0,
    maxBounds: C.grenzen,
    maxPitch: 78,
    attributionControl: { compact: true, customAttribution: [
      C.autor ? `Umsetzung: <a href="${esc(C.autor.url)}" target="_blank" rel="noopener">${esc(C.autor.name)}</a>` : "",
      // '<a href="rechtliches.html">Impressum & Datenschutz</a>', // vorerst ausgeblendet – zum Aktivieren Kommentar entfernen
    ].filter(Boolean) },
  });
  window.ostheimKarte = map; // für Einbettung/Debugging
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true });
  map.addControl(geo, "top-left");
  document.querySelector(".maplibregl-ctrl-top-left").style.display = "none";

  const daten = Promise.all([
    fetch("data/pois.geojson").then((r) => r.json()),
    fetch("data/routes.geojson").then((r) => r.json()),
    fetch("data/inhalte.json").then((r) => r.json()).catch(() => ({})),
  ]);

  // Marker-Bild je Kategorie (Kreis + Emoji), per Canvas erzeugt
  function markerImage(farbe, icon, size = 72) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const r = size / 2 - 6;
    g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 6; g.shadowOffsetY = 2;
    g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
    g.shadowColor = "transparent";
    g.beginPath(); g.arc(size / 2, size / 2, r - 4, 0, Math.PI * 2); g.fillStyle = farbe; g.fill();
    g.font = `${Math.round(size * 0.42)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(icon, size / 2, size / 2 + 2);
    return g.getImageData(0, 0, size, size);
  }

  // Kachel-URLs absolut machen (MapLibre lädt Kacheln in Web-Workern, relative Pfade gehen dort nicht)
  const basis = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  const abs = (u) => (/^https?:/.test(u) ? u : basis + u);

  // Ersatz-Stil, falls OpenFreeMap nicht erreichbar ist (Blocker, Ausfall): Luftbild Bayern + lokale Schriften
  let ersatz = false;
  function ersatzStil() {
    if (ersatz || map.isStyleLoaded()) return;
    ersatz = true;
    map.setStyle({ version: 8, glyphs: abs("fonts/{fontstack}/{range}.pbf"), sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": "#e8ecdf" } }] });
    hinweis("Die Standard-Kartenansicht ist gerade nicht erreichbar (evtl. durch einen Werbe-/Tracking-Blocker) – es wird das Luftbild angezeigt.");
  }
  map.on("error", (e) => { if (!map.isStyleLoaded() && !e.sourceId) ersatzStil(); });
  setTimeout(ersatzStil, 8000);

  // Kachelfehler der Grundkarte erkennen (z. B. Werbe-/Tracking-Blocker) und Hinweis zeigen
  let kachelFehler = 0, kachelOk = false;
  map.on("sourcedata", (e) => { if (e.sourceId === "openmaptiles" && e.tile) kachelOk = true; });
  map.on("error", (e) => {
    if (kachelOk || !(e.sourceId === "openmaptiles" || /openfreemap/.test(e.error?.url || e.error?.message || ""))) return;
    if (!ersatz && ++kachelFehler === 3) hinweis("Der Kartenhintergrund konnte nicht geladen werden. Vermutlich blockiert ein Werbe- oder Tracking-Blocker „tiles.openfreemap.org“ – bitte für diese Seite deaktivieren.");
  });
  setTimeout(() => { if (!ersatz && !kachelOk && !map.loaded()) hinweis("Der Kartenhintergrund lädt nicht. Bitte Internetverbindung prüfen oder Werbe-/Tracking-Blocker für diese Seite deaktivieren."); }, 12000);

  // Aufbau schon nach dem Laden des Stils – nicht erst, wenn alle Kacheln da sind (sonst bleibt bei blockierten Kacheln alles leer)
  map.once("style.load", async () => {
    const [pois, routes, inhalte] = await daten;
    state.pois = pois.features;
    state.routes = routes.features;
    state.inhalte = inhalte;

    const layers = map.getStyle().layers;
    const firstSymbol = layers.find((l) => l.type === "symbol")?.id;
    // Eigene POIs ersetzen die allgemeinen POIs des Grundkartenstils
    for (const l of layers) if (/^poi_r/.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none");

    // Gelände + Schummerung
    const dem = { type: "raster-dem", tiles: C.gelaende.tiles.map(abs), encoding: C.gelaende.encoding, tileSize: 256,
      minzoom: C.gelaende.minzoom ?? 0, maxzoom: C.gelaende.maxzoom ?? 14, ...(C.gelaende.bounds && { bounds: C.gelaende.bounds }) };
    map.addSource("dem", { ...dem, attribution: C.gelaende.attribution });
    map.addSource("dem-hill", dem);
    map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hill", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#3b4a3a" } }, map.getLayer("building") ? "building" : undefined);

    // Luftbild Bayern
    map.addSource("luftbild", { type: "raster", tiles: C.luftbild.tiles, tileSize: 256, attribution: C.luftbild.attribution });
    map.addLayer({ id: "luftbild", type: "raster", source: "luftbild", layout: { visibility: ersatz ? "visible" : "none" } }, firstSymbol);
    if (ersatz) { state.luftbild = true; $("#btn-luftbild").setAttribute("aria-pressed", true); }

    // Wege
    map.addSource("routes", { type: "geojson", data: routes, promoteId: "id" });
    const breite = (plus = 0) => ["interpolate", ["linear"], ["zoom"],
      11, ["case", ["get", "lokal"], 2.5 + plus, 1.5 + plus], 16, ["case", ["get", "lokal"], 6 + plus, 3.5 + plus]];
    const lineWidth = breite();
    map.addLayer({ id: "routes-casing", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-opacity": ["case", ["get", "lokal"], 0.9, 0.5], "line-width": breite(3) } }, firstSymbol);
    map.addLayer({ id: "routes-line", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "farbe"], "line-width": lineWidth,
        "line-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 1, ["get", "lokal"], 0.85, 0.55] } }, firstSymbol);
    map.addLayer({ id: "routes-sel", type: "line", source: "routes", filter: ["==", ["get", "id"], ""], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "farbe"], "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 10] } }, firstSymbol);
    map.addLayer({ id: "routes-hit", type: "line", source: "routes", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 18 } }, firstSymbol);

    // Orte
    // Markerbild je Kategorie bzw. je eigenem Symbol (z. B. ⛽ bei Tankstellen)
    for (const f of state.pois) {
      const p = f.properties, k = C.kategorien[p.kategorie] || { farbe: "#555", icon: "📍" };
      p._img = "img-" + p.kategorie + "-" + (p.icon || k.icon);
      if (!map.hasImage(p._img)) map.addImage(p._img, markerImage(k.farbe, p.icon || k.icon), { pixelRatio: 2 });
    }
    map.addSource("pois", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 42, clusterMaxZoom: 14 });
    map.addLayer({ id: "cluster", type: "circle", source: "pois", filter: ["has", "point_count"],
      paint: { "circle-color": "#1f2a44", "circle-radius": ["step", ["get", "point_count"], 17, 10, 21, 25, 26],
        "circle-stroke-width": 3, "circle-stroke-color": "#fff", "circle-opacity": 0.92 } });
    map.addLayer({ id: "cluster-count", type: "symbol", source: "pois", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 14, "text-allow-overlap": true },
      paint: { "text-color": "#fff" } });
    map.addLayer({ id: "poi", type: "symbol", source: "pois", filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["get", "_img"], "icon-size": 1, "icon-allow-overlap": true,
        "symbol-sort-key": ["case", ["==", ["get", "kategorie"], "Sehenswürdigkeit"], 0, 1],
        "text-field": ["step", ["zoom"], "", 15.5, ["get", "name"]], "text-font": ["Noto Sans Bold"], "text-size": 12.5,
        "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true, "text-max-width": 9,
      },
      paint: { "text-color": "#1b2233", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
    map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "sel-ring", type: "circle", source: "sel",
      paint: { "circle-radius": 26, "circle-color": "rgba(200,16,46,.18)", "circle-stroke-color": "#c8102e", "circle-stroke-width": 3, "circle-pitch-alignment": "map" } }, "poi");
    // ausgewählter Ort liegt immer obenauf
    map.addLayer({ id: "sel-icon", type: "symbol", source: "sel",
      layout: { "icon-image": ["get", "_img"], "icon-size": 1.25, "icon-allow-overlap": true, "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"], "text-size": 14, "text-offset": [0, 1.9], "text-anchor": "top", "text-allow-overlap": true },
      paint: { "text-color": "#c8102e", "text-halo-color": "#fff", "text-halo-width": 2 } });

    if (state.is3d) setTerrain(true);
    // Quellenangabe (OSM-Pflicht) erst sichtbar, beim ersten Verschieben/Zoomen klappt sie zum ⓘ zusammen
    const attrib = document.querySelector(".maplibregl-ctrl-attrib");
    attrib?.classList.add("maplibregl-compact-show");
    map.once("dragstart", () => attrib?.classList.remove("maplibregl-compact-show"));
    map.once("zoomstart", (e) => e.originalEvent && attrib?.classList.remove("maplibregl-compact-show"));
    bindMapEvents();
    renderChips();
    applyFilter();
    // Deep-Link erst anfliegen, wenn Gelände geladen ist – spätestens aber nach 4 s
    let hashGelesen = false;
    const leseHash = () => { if (!hashGelesen) { hashGelesen = true; readHash(); } };
    map.once("idle", leseHash);
    setTimeout(leseHash, 4000);
  });

  // ------------------------------------------------------------------ Filter & Suche
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const poiMatches = (f) => {
    const p = f.properties;
    if (state.suche) return norm([p.name, p.beschreibung, p.adresse, p.ort, C.kategorien[p.kategorie]?.label].join(" ")).includes(state.suche);
    return state.aktiv.has(p.kategorie);
  };
  const routeMatches = (f) => !state.suche || norm([f.properties.name, f.properties.text, f.properties.art].join(" ")).includes(state.suche);

  function applyFilter() {
    const sichtbar = state.pois.filter(poiMatches);
    map.getSource("pois")?.setData({ type: "FeatureCollection", features: sichtbar });
    const wegeSichtbar = state.wege || state.auswahl?.typ === "weg" || (state.suche && state.routes.some(routeMatches));
    for (const id of ["routes-casing", "routes-line", "routes-hit"]) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, "visibility", wegeSichtbar ? "visible" : "none");
      map.setFilter(id, state.suche ? ["in", ["get", "id"], ["literal", state.routes.filter(routeMatches).map((r) => r.id)]] : null);
    }
    $("#anz-orte").textContent = sichtbar.length;
    $("#anz-wege").textContent = state.routes.filter(routeMatches).length;
    if (!state.auswahl) renderList();
  }

  function renderChips() {
    const nav = $("#chips");
    const counts = {};
    for (const f of state.pois) counts[f.properties.kategorie] = (counts[f.properties.kategorie] || 0) + 1;
    const chip = (key, label, icon, farbe, pressed) =>
      `<button class="chip" data-kat="${esc(key)}" aria-pressed="${pressed}"><span class="dot" style="background:${farbe}">${icon}</span>${esc(label)}</button>`;
    nav.innerHTML = chip("__wege", "Wege", "🥾", "#2d6a4f", state.wege) +
      katOrder.filter((k) => counts[k]).map((k) => chip(k, C.kategorien[k].label, C.kategorien[k].icon, C.kategorien[k].farbe, state.aktiv.has(k))).join("");
    nav.onclick = (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const k = b.dataset.kat;
      if (k === "__wege") state.wege = !state.wege;
      else state.aktiv.has(k) ? state.aktiv.delete(k) : state.aktiv.add(k);
      b.setAttribute("aria-pressed", k === "__wege" ? state.wege : state.aktiv.has(k));
      if (k === "__wege" && state.wege) setTab("wege");
      else if (k !== "__wege" && state.aktiv.has(k)) setTab("orte");
      applyFilter();
    };
  }

  let sucheTimer;
  $("#suche").addEventListener("input", (e) => {
    clearTimeout(sucheTimer);
    sucheTimer = setTimeout(() => {
      state.suche = norm(e.target.value.trim());
      if (state.auswahl) closeDetail(false);
      applyFilter();
      if (state.suche) setSheet("half");
    }, 120);
  });

  // ------------------------------------------------------------------ Listen
  function setTab(tab) {
    state.tab = tab;
    $("#tab-orte").setAttribute("aria-selected", tab === "orte");
    $("#tab-wege").setAttribute("aria-selected", tab === "wege");
    if (state.auswahl) closeDetail(false); else renderList();
  }
  $("#tab-orte").onclick = () => setTab("orte");
  $("#tab-wege").onclick = () => setTab("wege");

  function poiItem(f) {
    const p = f.properties, k = C.kategorien[p.kategorie] || {};
    const sub = [p.status !== "aktiv" ? "⚠ " + p.status : null, p.adresse, p.ort !== "Ostheim" ? p.ort : null].filter(Boolean).join(" · ") || k.label;
    return `<button class="item" data-ort="${esc(f.id)}"><span class="ico" style="background:${k.farbe}22">${p.icon || k.icon || "📍"}</span>
      <span class="txt"><strong>${esc(p.name)}</strong><span>${esc(sub)}</span></span></button>`;
  }
  function routeItem(f) {
    const p = f.properties;
    const sub = [p.laenge, p.dauer, p.schwierigkeit].filter(Boolean).join(" · ") || p.art;
    return `<button class="item" data-weg="${esc(f.id)}"><span class="swatch" style="background:${esc(p.farbe)}"></span>
      <span class="txt"><strong>${esc(p.name)}</strong><span>${esc(sub)}</span></span></button>`;
  }

  function renderList() {
    const body = $("#sheet-body");
    let html = "";
    if (state.tab === "orte") {
      const list = state.pois.filter(poiMatches);
      const hl = list.filter((f) => state.inhalte[f.id]?.highlight);
      if (hl.length && !state.suche) html += `<div class="list-section">Highlights</div>` + hl.map(poiItem).join("");
      for (const k of katOrder) {
        const items = list.filter((f) => f.properties.kategorie === k).sort((a, b) => a.properties.name.localeCompare(b.properties.name, "de"));
        if (items.length) html += `<div class="list-section">${C.kategorien[k].icon} ${esc(C.kategorien[k].label)}</div>` + items.map(poiItem).join("");
      }
      if (!list.length) html = `<p class="empty">Keine Orte gefunden. Kategorien oben antippen, um mehr anzuzeigen.</p>`;
    } else {
      const list = state.routes.filter(routeMatches);
      const gruppen = [["Rund um Ostheim", (p) => p.lokal && p.art !== "Radweg"], ["Radwege", (p) => p.art === "Radweg"], ["Fernwanderwege", (p) => !p.lokal && p.art !== "Radweg"]];
      for (const [t, fn] of gruppen) {
        const items = list.filter((f) => fn(f.properties));
        if (items.length) html += `<div class="list-section">${t}</div>` + items.map(routeItem).join("");
      }
      if (!list.length) html = `<p class="empty">Keine Wege gefunden.</p>`;
    }
    const autor = C.autor ? `Umsetzung: <a href="${esc(C.autor.url)}" target="_blank" rel="noopener">${esc(C.autor.name)}</a> · ` : "";
    // Impressum-Link vorerst ausgeblendet – zum Aktivieren die nächste Zeile statt der übernächsten nutzen:
    // body.innerHTML = html + `<p class="source" style="margin:18px 16px 4px">${autor}<a href="rechtliches.html">Impressum & Datenschutz</a> · Angaben ohne Gewähr</p>`;
    body.innerHTML = html + `<p class="source" style="margin:18px 16px 4px">${autor}Angaben ohne Gewähr</p>`;
  }

  $("#sheet-body").addEventListener("click", (e) => {
    const o = e.target.closest("[data-ort]"), w = e.target.closest("[data-weg]");
    if (o) selectPoi(o.dataset.ort);
    else if (w) selectRoute(w.dataset.weg);
  });

  // ------------------------------------------------------------------ Detail
  const icons = {
    tel: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>',
    web: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16 16 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.9 5.5 8.4 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.7-5.6a16 16 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4zM14 14.5V12h-4v3H8v-4c0-.6.4-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg>',
    pano: '<svg viewBox="0 0 24 24"><path d="M12 7C6.5 7 2 8.3 2 10v4c0 1.5 3.6 2.8 8.5 3l-1.8 1.8 1.4 1.4L14.3 16l-4.2-4.2-1.4 1.4 1.7 1.7C6.4 14.7 4 13.9 4 13.5v-2.1C5.9 12.4 8.8 13 12 13s6.1-.6 8-1.6v2.1c0 .4-1.8 1-4.5 1.3v2c4-.4 6.5-1.6 6.5-2.8v-4c0-1.7-4.5-3-10-3z"/></svg>',
    map: '<svg viewBox="0 0 24 24"><path d="m15 5-6-2-6 2v16l6-2 6 2 6-2V3l-6 2zm0 13.9-6-2V5.1l6 2v11.8z"/></svg>',
  };
  const action = (href, label, icon, primary, attrs = "") =>
    `<a class="action${primary ? " primary" : ""}" href="${esc(href)}" ${attrs}>${icons[icon]}${esc(label)}</a>`;
  const navUrl = (lat, lon) => /iPad|iPhone|Macintosh/.test(navigator.userAgent) && "ontouchend" in document
    ? `https://maps.apple.com/?daddr=${lat},${lon}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  const storyHtml = (txt, titel = "Geschichte") => txt
    ? `<section class="story"><h3>${titel}</h3>${txt.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("")}</section>` : "";
  function heroHtml(bilder) {
    if (!bilder?.length) return "";
    return `<div class="hero"><div class="hero-track">${bilder.map((b, i) =>
      `<img src="${esc(b.src)}" alt="${esc(b.titel || "")}" loading="lazy" data-bild="${i}">`).join("")}</div>
      ${bilder.length > 1 ? `<span class="count">${bilder.length} Bilder</span>` : ""}</div>`;
  }

  function selectPoi(id, { fly = true } = {}) {
    const f = state.pois.find((x) => x.id === id);
    if (!f) return;
    const p = f.properties, k = C.kategorien[p.kategorie] || {}, extra = state.inhalte[id] || {};
    const [lon, lat] = f.geometry.coordinates;
    clearRouteSel();
    state.auswahl = { typ: "ort", id };
    map.getSource("sel")?.setData({ type: "FeatureCollection", features: [f] });
    const tel = p.telefon ? p.telefon.replace(/[^\d+]/g, "").replace(/^0/, "+49") : "";
    $("#sheet-body").innerHTML = `<article class="detail">
      <div class="detail-top"><button class="back" data-back>‹ Zurück</button></div>
      ${heroHtml(extra.bilder)}
      <h2>${esc(p.name)}</h2>
      <div class="badges"><span class="badge" style="background:${k.farbe}22">${k.icon || ""} ${esc(k.label || p.kategorie)}</span>
        ${p.ort && p.ort !== "Ostheim" ? `<span class="badge">📍 ${esc(p.ort)}</span>` : ""}
        ${p.status !== "aktiv" ? `<span class="badge warn">⚠ ${esc(p.status)}</span>` : ""}</div>
      ${p.beschreibung ? `<p class="lead">${esc(p.beschreibung)}</p>` : ""}
      <div class="actions">
        ${tel ? action("tel:" + tel, "Anrufen", "tel", true) : ""}
        ${p.web ? action(p.web, "Website", "web", !tel, 'target="_blank" rel="noopener"') : ""}
        ${action(navUrl(lat, lon), "Route", "nav", !tel && !p.web, 'target="_blank" rel="noopener"')}
        ${extra.panorama?.src ? `<button class="action" data-pano>${icons.pano}360°</button>` : ""}
        <button class="action" data-share>${icons.share}Teilen</button>
      </div>
      <div class="facts">
        ${p.adresse ? `<div class="fact"><span class="k">📍</span><span>${esc(p.adresse)}${p.ort && p.ort !== "Ostheim" ? ", " + esc(p.ort) : ""}<br><small>97645 Ostheim v.d.Rhön</small></span></div>` : ""}
        ${p.telefon ? `<div class="fact"><span class="k">📞</span><a href="tel:${esc(tel)}">${esc(p.telefon)}</a></div>` : ""}
        ${p.web ? `<div class="fact"><span class="k">🌐</span><a href="${esc(p.web)}" target="_blank" rel="noopener">${esc(p.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a></div>` : ""}
        ${p.oeffnungszeiten ? `<div class="fact"><span class="k">🕒</span><span>${esc(p.oeffnungszeiten)}</span></div>` : ""}
      </div>
      ${storyHtml(extra.geschichte)}
      <p class="source">Quelle: ${esc(p.quelle)} · Angaben ohne Gewähr</p>
    </article>`;
    $("#sheet-body").scrollTop = 0;
    bindDetail(extra, f);
    setSheet("half");
    if (fly) flyTo([lon, lat], Math.max(map.getZoom(), 16.2));
    setHash("ort=" + id);
  }

  function selectRoute(id, { fly = true } = {}) {
    const f = state.routes.find((x) => x.id === id);
    if (!f) return;
    const p = f.properties, extra = state.inhalte[id] || {};
    clearRouteSel();
    map.getSource("sel")?.setData({ type: "FeatureCollection", features: [] });
    state.auswahl = { typ: "weg", id };
    map.setFilter("routes-sel", ["==", ["get", "id"], id]);
    map.setFeatureState({ source: "routes", id }, { sel: true });
    applyFilter();
    const stat = (v, l) => (v ? `<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>` : "");
    $("#sheet-body").innerHTML = `<article class="detail">
      <div class="detail-top"><button class="back" data-back>‹ Zurück</button></div>
      ${heroHtml(extra.bilder)}
      <h2>${esc(p.name)}</h2>
      <div class="badges"><span class="badge" style="background:${esc(p.farbe)}33">${p.art === "Radweg" ? "🚲" : "🥾"} ${esc(p.art)}</span></div>
      <div class="stats">${stat(p.laenge, "Länge")}${stat(p.dauer, "Dauer")}${stat(p.hm, "Anstieg")}${stat(p.schwierigkeit, "Schwierigkeit")}</div>
      ${p.text ? `<p class="lead">${esc(p.text)}</p>` : ""}
      <div class="actions">
        <button class="action primary" data-fit>${icons.map}Ganzer Weg</button>
        ${extra.panorama?.src ? `<button class="action" data-pano>${icons.pano}360°</button>` : ""}
        <button class="action" data-share>${icons.share}Teilen</button>
      </div>
      ${p.start ? `<div class="facts"><div class="fact"><span class="k">🚩</span><span><b>Start:</b> ${esc(p.start)}</span></div></div>` : ""}
      ${storyHtml(extra.geschichte, "Unterwegs")}
      <div class="links">${p.links.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join("")}</div>
      <p class="source">Wegverlauf: OpenStreetMap-Mitwirkende · Angaben ohne Gewähr</p>
    </article>`;
    $("#sheet-body").scrollTop = 0;
    bindDetail(extra, f);
    setSheet("half");
    if (fly) fitRoute(f);
    setHash("weg=" + id);
  }

  function bindDetail(extra, f) {
    const body = $("#sheet-body");
    body.querySelector("[data-back]").onclick = () => closeDetail();
    body.querySelector("[data-share]").onclick = async () => {
      const url = location.href;
      try {
        if (navigator.share) await navigator.share({ title: f.properties.name, url });
        else { await navigator.clipboard.writeText(url); toast("Link kopiert"); }
      } catch { /* abgebrochen */ }
    };
    const pano = body.querySelector("[data-pano]");
    if (pano) pano.onclick = () => openPano(extra.panorama);
    const fit = body.querySelector("[data-fit]");
    if (fit) fit.onclick = () => fitRoute(f);
    body.querySelectorAll("[data-bild]").forEach((img) => (img.onclick = () => {
      const b = extra.bilder[+img.dataset.bild];
      $("#lightbox-img").src = b.src;
      $("#lightbox-cap").textContent = [b.titel, b.quelle && "© " + b.quelle].filter(Boolean).join(" · ");
      $("#lightbox").hidden = false;
    }));
  }
  $("#lightbox-close").onclick = () => ($("#lightbox").hidden = true);

  function clearRouteSel() {
    if (state.auswahl?.typ === "weg") map.setFeatureState({ source: "routes", id: state.auswahl.id }, { sel: false });
    if (map.getLayer("routes-sel")) map.setFilter("routes-sel", ["==", ["get", "id"], ""]);
  }
  function closeDetail(render = true) {
    clearRouteSel();
    state.auswahl = null;
    map.getSource("sel")?.setData({ type: "FeatureCollection", features: [] });
    setHash("");
    applyFilter();
    if (render) renderList();
  }

  // ------------------------------------------------------------------ Kamera
  function padding() {
    if (isDesktop()) return { left: 424, top: 80, right: 70, bottom: 30 };
    const sheetH = innerHeight * 0.5;
    return { top: 170, bottom: sheetH, left: 20, right: 70 };
  }
  // Eigene Kamerafahrt: MapLibres flyTo/easeTo setzen die Geländehöhe des Ziels im 3D-Modus falsch,
  // dann liegt z. B. die Lichtenburg nicht in der Bildmitte. Hier wird die Höhe in jedem Bild mitgeführt.
  let fahrtId = 0;
  const hoehe = (ll) => (state.is3d ? map.queryTerrainElevation(ll) ?? map.getCenterElevation() : 0);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function fahrt({ center, zoom = map.getZoom(), pitch = map.getPitch(), bearing = map.getBearing(), pad = padding(), duration = 1600, easing = easeInOut }) {
    const id = ++fahrtId;
    const c0 = map.getCenter(), z0 = map.getZoom(), p0 = map.getPitch(), b0 = map.getBearing(), e0 = map.getCenterElevation();
    const pad0 = map.getPadding();
    const c1 = maplibregl.LngLat.convert(center ?? c0);
    const e1 = hoehe(c1);
    let db = ((bearing - b0 + 540) % 360) - 180;
    // Bei weiten Sprüngen kurz herauszoomen (Flugkurve)
    const px = map.project(c1).dist(map.project(c0));
    const dip = Math.max(0, Math.min(3, Math.log2(px / (0.6 * Math.min(innerWidth, innerHeight)))));
    const lerp = (a, b, t) => a + (b - a) * t;
    if (reduceMotion || duration <= 0) {
      map.jumpTo({ center: c1, zoom, pitch, bearing, elevation: e1, padding: pad });
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        if (id !== fahrtId) return resolve(false); // abgebrochen
        const r = Math.max(0, Math.min(1, (now - t0) / duration)), t = easing(r);
        map.jumpTo({
          center: [lerp(c0.lng, c1.lng, t), lerp(c0.lat, c1.lat, t)],
          zoom: lerp(z0, zoom, t) - dip * Math.sin(Math.PI * t),
          pitch: lerp(p0, pitch, t), bearing: b0 + db * t, elevation: lerp(e0, e1, t),
          padding: { top: lerp(pad0.top, pad.top, t), bottom: lerp(pad0.bottom, pad.bottom, t), left: lerp(pad0.left, pad.left, t), right: lerp(pad0.right, pad.right, t) },
        });
        r < 1 ? requestAnimationFrame(frame) : resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }
  const stopFahrt = () => fahrtId++;
  function flyTo(center, zoom) {
    fahrt({ center, zoom, pitch: state.is3d ? 55 : 0 });
  }
  function fitRoute(f) {
    const b = new maplibregl.LngLatBounds();
    for (const line of f.geometry.coordinates) for (const c of line) b.extend(c);
    stopFahrt();
    const cam = map.cameraForBounds(b, { padding: padding(), maxZoom: 15.5 });
    fahrt({ center: cam.center, zoom: cam.zoom - (state.is3d ? 0.3 : 0), pitch: state.is3d ? 45 : 0, pad: { top: 0, bottom: 0, left: 0, right: 0 } });
  }

  // ------------------------------------------------------------------ Karte: Klicks
  function bindMapEvents() {
    map.on("click", "cluster", async (e) => {
      const f = e.features[0];
      const z = await map.getSource("pois").getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 });
    });
    map.on("click", "poi", (e) => selectPoi(e.features[0].properties.id));
    map.on("click", "routes-hit", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["poi", "cluster"] }).length) return;
      selectRoute(e.features[0].properties.id);
    });
    for (const l of ["poi", "cluster", "routes-hit"]) {
      map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
    }
    // Tooltip am PC
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 18 });
    map.on("mousemove", "poi", (e) => tip.setLngLat(e.features[0].geometry.coordinates).setText(e.features[0].properties.name).addTo(map));
    map.on("mouseleave", "poi", () => tip.remove());
    map.on("mousemove", "routes-hit", (e) => { if (!map.queryRenderedFeatures(e.point, { layers: ["poi"] }).length) tip.setLngLat(e.lngLat).setText(e.features[0].properties.name).addTo(map); });
    map.on("mouseleave", "routes-hit", () => tip.remove());
    // Nutzer greift ein → Rundflug stoppen
    for (const ev of ["mousedown", "touchstart", "wheel"]) map.on(ev, () => { stopFahrt(); if (state.tour) stopTour(); });
  }

  // ------------------------------------------------------------------ Werkzeuge
  function setTerrain(on) {
    state.is3d = on;
    $("#btn-3d").setAttribute("aria-pressed", on);
    map.setTerrain(on ? { source: "dem", exaggeration: C.gelaende.ueberhoehung } : null);
    if (map.getLayer("building-3d")) map.setLayoutProperty("building-3d", "visibility", on ? "visible" : "none");
  }
  $("#btn-3d").onclick = () => {
    setTerrain(!state.is3d);
    map.easeTo({ pitch: state.is3d ? 60 : 0, bearing: state.is3d ? map.getBearing() || -20 : 0, duration: 1000 });
  };
  $("#btn-luftbild").onclick = (e) => {
    state.luftbild = !state.luftbild;
    e.currentTarget.setAttribute("aria-pressed", state.luftbild);
    map.setLayoutProperty("luftbild", "visibility", state.luftbild ? "visible" : "none");
  };
  $("#btn-ort").onclick = () => geo.trigger();
  $("#btn-home").onclick = () => {
    stopTour();
    fahrt({ center: C.start.center, zoom: C.start.zoom, pitch: state.is3d ? C.start.pitch : 0, bearing: state.is3d ? C.start.bearing : 0, pad: { top: 0, bottom: 0, left: isDesktop() ? 412 : 0, right: 0 }, duration: 1800 });
  };

  // ------------------------------------------------------------------ Rundflug
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function startTour() {
    const stops = state.pois.filter((f) => state.inhalte[f.id]?.highlight);
    if (!stops.length) return;
    const tour = (state.tour = { aktiv: true });
    if (!state.is3d) setTerrain(true);
    $("#tour-banner").hidden = false;
    document.body.classList.add("touring");
    setSheet("peek");
    let bearing = map.getBearing();
    for (let i = 0; i < stops.length && tour.aktiv; i++) {
      const f = stops[i];
      $("#tour-text").textContent = `${i + 1}/${stops.length} · ${f.properties.name}`;
      bearing += 70;
      const pad = isDesktop() ? { top: 60, bottom: 0, left: 412, right: 60 } : { top: 120, bottom: 140, left: 0, right: 0 };
      if (!(await fahrt({ center: f.geometry.coordinates, zoom: 16.4, pitch: 64, bearing, pad, duration: 5500 }))) break;
      if (!tour.aktiv) break;
      map.getSource("sel").setData({ type: "FeatureCollection", features: [f] });
      if (!(await fahrt({ bearing: bearing + 40, pad, duration: 4500, easing: (t) => t }))) break;
    }
    if (tour.aktiv) { stopTour(); $("#btn-home").click(); }
  }
  function stopTour() {
    if (!state.tour) return;
    state.tour.aktiv = false;
    stopFahrt();
    state.tour = null;
    $("#tour-banner").hidden = true;
    document.body.classList.remove("touring");
    if (!state.auswahl) map.getSource("sel")?.setData({ type: "FeatureCollection", features: [] });
  }
  $("#btn-tour").onclick = () => (state.tour ? stopTour() : startTour());
  $("#tour-stop").onclick = stopTour;

  // ------------------------------------------------------------------ 360°-Panorama (Pannellum, lazy)
  let pannellumLaden;
  function loadPannellum() {
    if (window.pannellum) return Promise.resolve();
    return (pannellumLaden ??= new Promise((res, rej) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "vendor/pannellum/pannellum.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = "vendor/pannellum/pannellum.js"; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }));
  }
  let viewer;
  async function openPano(pano) {
    await loadPannellum();
    $("#pano").hidden = false;
    viewer?.destroy();
    viewer = pannellum.viewer("pano-viewer", { type: "equirectangular", panorama: pano.src, title: pano.titel || "", autoLoad: true, autoRotate: -2, showZoomCtrl: true, strings: { loadingLabel: "Lädt …" } });
  }
  $("#pano-close").onclick = () => { $("#pano").hidden = true; viewer?.destroy(); viewer = null; };

  // ------------------------------------------------------------------ Bottom-Sheet (Handy)
  const sheet = $("#sheet");
  let sheetState = "peek";
  function sheetY(s) {
    const h = sheet.offsetHeight, peek = parseFloat(getComputedStyle(sheet).getPropertyValue("--sheet-peek")) || 132;
    return { peek: h - peek, half: h - innerHeight * 0.5, full: 0 }[s];
  }
  function setSheet(s) {
    if (isDesktop()) return;
    sheetState = s;
    sheet.style.transform = `translateY(${sheetY(s)}px)`;
  }
  (() => {
    let startY = 0, startT = 0, dy = 0, dragging = false, moved = false;
    const down = (e) => {
      if (isDesktop()) return;
      if (e.target.closest(".sheet-body")) return; // Liste scrollt, gezogen wird an Griff/Tabs
      dragging = true; moved = false; startY = e.clientY; startT = sheetY(sheetState); dy = 0;
      sheet.classList.add("dragging");
    };
    const move = (e) => {
      if (!dragging) return;
      dy = e.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      sheet.style.transform = `translateY(${Math.max(0, startT + dy)}px)`;
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove("dragging");
      if (!moved) { return; }
      const y = startT + dy, order = ["full", "half", "peek"];
      let best = order.reduce((a, s) => (Math.abs(sheetY(s) - y) < Math.abs(sheetY(a) - y) ? s : a), "peek");
      if (Math.abs(dy) > 40 && best === sheetState) best = order[Math.min(2, Math.max(0, order.indexOf(sheetState) + (dy > 0 ? 1 : -1)))];
      setSheet(best);
    };
    sheet.addEventListener("pointerdown", down);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    $("#sheet-handle").addEventListener("click", () => setSheet(sheetState === "peek" ? "half" : sheetState === "half" ? "full" : "peek"));
    $("#sheet-body").addEventListener("scroll", () => { if (sheetState !== "full" && $("#sheet-body").scrollTop > 30) setSheet("full"); }, { passive: true });
    addEventListener("resize", () => (isDesktop() ? (sheet.style.transform = "") : setSheet(sheetState)));
    setSheet("peek");
  })();

  // ------------------------------------------------------------------ Hash / Einbettung
  let hashSelf = false;
  function setHash(h) {
    hashSelf = true;
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("ort")) selectPoi(h.get("ort"));
    else if (h.get("weg")) selectRoute(h.get("weg"));
  }
  addEventListener("hashchange", () => (hashSelf ? (hashSelf = false) : readHash()));
  addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "ostheim-karte") return;
    if (d.ort) selectPoi(d.ort);
    if (d.weg) selectRoute(d.weg);
  });

  function hinweis(t) {
    if (document.getElementById("hinweis")) return;
    const el = document.createElement("div");
    el.id = "hinweis"; el.setAttribute("role", "alert"); el.textContent = t;
    el.style.cssText = "position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 150px);transform:translateX(-50%);max-width:min(520px,calc(100% - 24px));background:#fff1d6;color:#5c3700;padding:12px 16px;border-radius:14px;z-index:30;font-size:14px;line-height:1.4;box-shadow:0 8px 28px rgba(16,24,40,.25)";
    el.title = "Antippen zum Schließen"; el.style.cursor = "pointer";
    el.onclick = () => el.remove();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  }

  function toast(t) {
    const el = document.createElement("div");
    el.textContent = t;
    el.style.cssText = "position:fixed;left:50%;bottom:30%;transform:translateX(-50%);background:#1f2a44;color:#fff;padding:10px 16px;border-radius:99px;z-index:30;font-weight:600";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  renderList();
})();
