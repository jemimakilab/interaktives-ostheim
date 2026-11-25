// Zentrale Einstellungen der Ostheim-Karte. Hier anpassen, nicht im app.js.
window.KARTE_CONFIG = {
  titel: "Ostheim v.d.Rhön entdecken",
  // Urheber der Karte – erscheint in der Quellenangabe, unter der Liste und im Impressum
  autor: { name: "Jean-Michel Matysiak", url: "https://github.com/jemimakilab" },
  untertitel: "Kirchenburg · Lichtenburg · Rhön",
  start: { center: [10.2318, 50.4594], zoom: 14.2, pitch: 50, bearing: -20 },
  grenzen: [[9.95, 50.36], [10.45, 50.56]], // Karte lässt sich nicht weiter wegschieben
  // Für vollständige Unabhängigkeit später selbst hosten (Protomaps/PMTiles), siehe README.
  // Grundkarte: OpenStreetMap-Ausschnitt der Region als eine Datei (Protomaps/PMTiles) – liegt auf der eigenen Seite,
  // keine fremden Server, keine Probleme mit Werbe-/Tracking-Blockern. Neu erzeugen: siehe README („Grundkarte aktualisieren“).
  grundkarte: {
    pmtiles: "tiles/ostheim.pmtiles",
    flavor: "light",
    attribution: '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  },

  // Amtliches Luftbild Bayern (Open Data, CC BY 4.0)
  luftbild: {
    tiles: ["https://geoservices.bayern.de/od/wms/dop/v1/dop40?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=by_dop40c&STYLES=&FORMAT=image/jpeg&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}"],
    attribution: '<a href="https://geodaten.bayern.de/opengeodata/" target="_blank" rel="noopener">Luftbild © Bayerische Vermessungsverwaltung (CC BY 4.0)</a>'
  },

  // Geländemodell für 3D – lokal im Ordner terrain/ (Ausschnitt der AWS Terrain Tiles, Open Data),
  // damit keine Anfragen an Server außerhalb der EU gehen. Neu erzeugen: daten/terrain_laden.sh
  gelaende: {
    tiles: ["terrain/{z}/{x}/{y}.png"],
    encoding: "terrarium", minzoom: 6, maxzoom: 13,
    bounds: [9.95, 50.36, 10.45, 50.56],
    attribution: '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Gelände: Mapzen/AWS Terrain Tiles</a>',
    ueberhoehung: 1.6
  },


  kategorien: {
    "Sehenswürdigkeit":    { label: "Sehenswert",   icon: "🏰", farbe: "#8a3ffc" },
    "Museum/Kultur":       { label: "Kultur",       icon: "🎭", farbe: "#6929c4" },
    "Restaurant/Gasthaus": { label: "Essen",        icon: "🍽️", farbe: "#da1e28" },
    "Café/Eis":            { label: "Café & Eis",   icon: "☕", farbe: "#b5651d" },
    "Imbiss":              { label: "Imbiss",       icon: "🌭", farbe: "#ff832b" },
    "Biergarten":          { label: "Biergarten",   icon: "🍺", farbe: "#d4a106" },
    "Vereinsheim":         { label: "Vereinsheim",  icon: "⚽", farbe: "#a56eff" },
    "Hofladen/Regional":   { label: "Regional",     icon: "🧺", farbe: "#198038" },
    "Lebensmittel":        { label: "Lebensmittel", icon: "🛒", farbe: "#24a148" },
    "Einkaufen":           { label: "Einkaufen",    icon: "🛍️", farbe: "#b28600" },
    "Gesundheit":          { label: "Gesundheit",   icon: "💊", farbe: "#ee538b" },
    "Auto & Mobilität":    { label: "Auto & Tanken", icon: "🚗", farbe: "#4589ff" },
    "Dienstleistung":      { label: "Dienstleister", icon: "💼", farbe: "#6f6f6f" },
    "Handwerk & Gewerbe":  { label: "Handwerk & Firmen", icon: "🔧", farbe: "#8a6d3b" },
    "Öffentlich":          { label: "Öffentlich",   icon: "🏛️", farbe: "#525e8a" },
    "Toiletten":           { label: "Toiletten",    icon: "🚻", farbe: "#0f62fe" },
    "Praktisches":         { label: "Parken & Co.", icon: "🅿️", farbe: "#393939" },
    "Freizeit":            { label: "Freizeit",     icon: "🎯", farbe: "#0072c3" },
    "Spielplatz":          { label: "Spielplatz",   icon: "🛝", farbe: "#33b1ff" },
    "Camping/Wohnmobil":   { label: "Camping",      icon: "🚐", farbe: "#005d5d" },
    "Übernachtung":        { label: "Übernachten",  icon: "🛏️", farbe: "#9f1853" }
  },
  startLuftbild: false, // true = Luftbild als Startansicht (lädt dann beim Öffnen von geoservices.bayern.de); false = Straßenkarte, Luftbild nur per Knopf
  // Beim Start ausgeblendete Kategorien (über die Filterleiste einblendbar)
  startAusgeblendet: ["Praktisches"]
};
