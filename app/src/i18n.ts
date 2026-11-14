import { createContext, useContext } from "react";

export type Lang = "en" | "es";

const MONTHS_SHORT = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
};
const MONTHS_LONG = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};
const INITIALS = { en: "JFMAMJJASOND".split(""), es: "EFMAMJJASOND".split("") };

const en = {
  title: "Is this fire normal?",
  subtitle: "Tata Rekavo · 24 years of NASA MODIS + VIIRS fire hotspots over Paraguay, harmonized into one record",
  method: "Method & validation", code: "Code",
  loading: "Loading 24 years of fire hotspots…", loadError: "Could not load the data:",
  step1: "1 · Choose an area", step2: "2 · Choose a month",
  zones: { paraguay: "Paraguay", chaco: "Chaco", oriental: "Oriental", draw: "✎ Draw" },
  zoneIn: { paraguay: "Paraguay", chaco: "the Chaco", oriental: "the Oriental region", custom: "your zone" },
  cellsArea: (cells: string, km2: string) => `${cells} grid cells · ~${km2} km²`,
  smallArea: " · small area: months before 2012 carry a larger error",
  noCells: " · no cells inside, draw a larger area",
  inProgress: " (in progress)", prev: "Previous month", next: "Next month", monthAria: "Month",
  verdictWhen: (month: string, zone: string, pct: number | null) => `${month} in ${zone}${pct !== null ? ` · first ${pct}% of the month` : ""}`,
  ofUsual: "of the usual level",
  classes: { low: "Below normal", normal: "Normal", high: "High", extreme: "Extreme" } as Record<string, string>,
  hotspots: "hotspots", vsUsual: "vs a usual",
  forPart: (m: string, partial: boolean) => (partial ? `for this part of ${m}` : `for ${m}`),
  medianOf: (n: number) => `median of ${n} previous years.`,
  rank: (r: number, m: string, total: number) => (r === total ? `Lowest ${m} out of ${total} on record.`
    : r > total / 2 ? `${ordinalEn(total - r + 1)} lowest ${m} out of ${total} on record.`
    : `${r === 1 ? "Highest" : `${ordinalEn(r)} highest`} ${m} out of ${total} on record.`),
  source: "Source:",
  srcTranslated: "MODIS Aqua, translated to VIIRS-equivalent",
  srcObserved: "VIIRS S-NPP observed (outage days filled with NOAA-20)",
  nrt: "near real-time", days: "d",
  calendarTitle: (z: string) => `Burning calendar · ${z}`,
  calendarAria: "Burning calendar: months by year, colored by ratio to the usual level",
  year: "year",
  calNote: "Each square compares a month with the median of the same month over 2002–2026. Hatched squares (before Feb 2012) are reconstructed from MODIS.",
  calFirstPct: (p: number) => ` (first ${p}% of month)`,
  calVsUsual: (r: string, m: string, med: string) => `×${r} vs usual ${m} (${med})`,
  translatedFrom: "translated from MODIS Aqua", observedBy: "observed by VIIRS",
  normalBin: "≈ normal",
  perYear: "Hotspots per year", harmonized: "Harmonized", rawSensors: "Raw sensors",
  legendModisRaw: "MODIS raw", legendViirsRaw: "VIIRS raw",
  legendTranslated: "MODIS Aqua → VIIRS-equivalent (± error)", legendObserved: "VIIRS observed",
  viirsStarts: "VIIRS starts", julDec: " (Jul–Dec)", toDate: " (to date)",
  rawCount: "raw sensor count", harmonizedCount: "harmonized",
  modisTA: "MODIS Terra + Aqua", viirsSnpp: "VIIRS S-NPP",
  chartAria: (a: number, b: number, naive: boolean) => `Hotspots per year ${a}–${b}, ${naive ? "raw sensors stitched together" : "harmonized"}`,
  noteNaive: "Stitching the raw sensors together makes fire look ~3× higher after 2012 — but that jump is the switch to the more sensitive VIIRS sensor, not more fire.",
  noteHarmonized: "One unit for 24 years: MODIS counts before 2012 are translated to what VIIRS would have detected, with a factor per region and calendar month.",
  newTitle: "Fire in new places",
  newStat: (n: string, total: string, pct: string) => `${n} of ${total} hotspots (${pct}%) are in places with no fire recorded within ~1 km since 2002.`,
  newNone: (total: string) => `None of the ${total} hotspots this month are in new places: all fall where fire was recorded before.`,
  newOnly: "Show only hotspots in new places",
  newUnavailable: "Individual hotspots are available for the months fetched from the FIRMS API (2026). Pick a 2026 month to see where fire appears in places with no history.",
  newNote: "“New place”: no hotspot from any sensor in the same or neighbouring ~1 km cells, July 2002 – December 2025. These hotspots deserve a closer look: new clearing, or fire reaching vegetation that had not burned before.",
  download: "Download", dlSeries: "Monthly series for this area (CSV)",
  dlHotspots: (n: string, y: string) => `${n} hotspots of ${y} in this area (CSV)`,
  footData: (last: string, to: string | null) => `Data: NASA FIRMS — MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20), vegetation fires only. Months up to ${last} from the standard-processing archives; later months from the FIRMS API${to ? ` (to ${to})` : ""}.`,
  footValidation: (a: number, b: number, c: number) => `Harmonization tested on held-out years: median monthly error ${a}% for Paraguay, ${b}% for the Chaco and ${c}% for the Oriental region.`,
  footHotspot: "A hotspot is a ~375 m–1 km pixel with active fire at the satellite's overpass, not a fire count. AI-assisted application. NASA Space Apps Challenge 2026 · Asunción.",
  drawHint: "Click to add points · double-click or Enter to finish · Esc to cancel",
  finish: (n: number) => `Finish zone (${n} pts)`,
  mapLegend: (m: string) => `Hotspots per ~11 km cell · ${m}`,
  legendDots: (n: string) => `individual VIIRS hotspots (${n})`,
  legendNew: (n: string) => `in a new place (${n})`,
  popupCell: (m: string) => `${m} · ~11 km cell`,
  // --- range, analytics, calendar modes, export, coordinates
  step3: "3 · Choose a date range",
  rangeFrom: "From", rangeTo: "To",
  presets: { year: "This year", last12: "Last 12 months", season: "Fire season (Jul–Oct)", all: "All" } as Record<string, string>,
  rangeTitle: (a: string, b: string) => `Analytics · ${a} – ${b}`,
  rangeTotal: (v: string, err: string) => `${v} hotspots${err}`,
  rangeVsTypical: (r: string, typ: string) => `×${r} the usual for these months (typical ${typ})`,
  rangePeak: (m: string, v: string) => `Peak month: ${m} (${v})`,
  rangeMonths: (hi: number, lo: number, n: number) => `${hi} of ${n} months above normal, ${lo} below`,
  rangeNew: (n: string) => `${n} hotspots in new places`,
  rangePartial: "includes a month in progress",
  calModeRatio: "vs normal", calModeCount: "Hotspots",
  typicalRow: "typical",
  calNoteCount: "Each square shows the number of harmonized hotspots. The “typical” row is the median of each month: it shows when the fire season happens.",
  outOfRange: "outside the selected range",
  dlSeriesRange: (a: string, b: string) => `Monthly series ${a} – ${b} (CSV)`,
  dlHotspotsRange: (a: string, b: string) => `Individual hotspots ${a} – ${b} in this area (CSV)`,
  dlHotspotsEstimate: (n: string) => `≈ ${n} hotspots`,
  dlTooMany: (n: string) => `≈ ${n} hotspots: too many for one file. Narrow the area or the date range (limit ≈ 1.5 million).`,
  dlPreparing: (a: number, b: number) => `Preparing… ${a}/${b} blocks`,
  dlReport: "Report image: calendar, yearly chart and analytics (PNG)",
  dlFailed: "Download failed:",
  coords: "⌖ Coordinates",
  coordsLat: "Latitude", coordsLon: "Longitude", coordsRadius: "Radius (km)", coordsApply: "Apply",
  coordsHelp: "Decimal degrees, e.g. −22.35, −60.03. Inside Paraguay.",
  coordsInvalid: "Enter a point inside Paraguay and a radius between 5 and 300 km.",
  zoneCoords: (lat: string, lon: string, r: string) => `${r} km around ${lat}, ${lon}`,
  reportTitle: "Is this fire normal? · Tata Rekavo",
  reportFooter: "Data: NASA FIRMS (MODIS C6.1, VIIRS 375 m), harmonized to VIIRS-equivalent hotspots. tata-rekavo.vercel.app",
  catador: {
    partial: (p: number) => `ℹ️ Physical check: month in progress (${p}% of its days). It is compared with the same share of a typical month and may still change.`,
    highObserved: "🔥 Physical check: clearly above usual, observed directly by VIIRS (no translation uncertainty). Worth cross-checking with satellite imagery or field reports.",
    highRobust: (lo: string) => `🔥 Physical check: clearly above usual, even at the low end of the error band (×${lo}). Worth cross-checking with satellite imagery or field reports.`,
    highUncertain: (lo: string, hi: string) => `⚠️ Physical check: above usual, but within the uncertainty band (×${lo}–×${hi}). Confirm with satellite imagery before drawing conclusions.`,
    lowRobust: "ℹ️ Physical check: clearly below usual. Fewer hotspots does not mean lower fire risk: unburned vegetation can build up.",
    lowUncertain: (lo: string, hi: string) => `ℹ️ Physical check: possibly below usual, within the uncertainty band (×${lo}–×${hi}).`,
    normal: "✅ Physical check: within the usual range for this month.",
    harmonizedBy: "🔄 Harmonized by Tata Rekavo",
    observedDirect: "🛰️ Direct VIIRS observation",
  },
  langLabel: "Idioma: español",
};
export type Dict = typeof en;

const es: Dict = {
  title: "¿Es normal este fuego?",
  subtitle: "Tata Rekavo · 24 años de focos de calor de NASA MODIS + VIIRS sobre Paraguay, armonizados en un solo registro",
  method: "Método y validación", code: "Código",
  loading: "Cargando 24 años de focos de calor…", loadError: "No se pudieron cargar los datos:",
  step1: "1 · Elegí un área", step2: "2 · Elegí un mes",
  zones: { paraguay: "Paraguay", chaco: "Chaco", oriental: "Oriental", draw: "✎ Dibujar" },
  zoneIn: { paraguay: "Paraguay", chaco: "el Chaco", oriental: "la Región Oriental", custom: "tu zona" },
  cellsArea: (cells, km2) => `${cells} celdas de la grilla · ~${km2} km²`,
  smallArea: " · área chica: los meses anteriores a 2012 tienen más error",
  noCells: " · no hay celdas adentro, dibujá un área más grande",
  inProgress: " (en curso)", prev: "Mes anterior", next: "Mes siguiente", monthAria: "Mes",
  verdictWhen: (month, zone, pct) => `${month} en ${zone}${pct !== null ? ` · primer ${pct}% del mes` : ""}`,
  ofUsual: "del nivel habitual",
  classes: { low: "Por debajo de lo normal", normal: "Normal", high: "Alto", extreme: "Extremo" },
  hotspots: "focos", vsUsual: "contra un habitual de",
  forPart: (m, partial) => (partial ? `para esta parte de ${m}` : `para ${m}`),
  medianOf: (n) => `mediana de ${n} años anteriores.`,
  rank: (r, m, total) => (r === total ? `El ${m} más bajo de ${total} registrados.`
    : r > total / 2 ? `El ${total - r + 1}.º ${m} más bajo de ${total} registrados.`
    : `${r === 1 ? "El" : `El ${r}.º`} ${m} más alto de ${total} registrados.`),
  source: "Fuente:",
  srcTranslated: "MODIS Aqua, traducido a equivalente VIIRS",
  srcObserved: "VIIRS S-NPP observado (días de corte rellenados con NOAA-20)",
  nrt: "tiempo casi real", days: "d",
  calendarTitle: (z) => `Calendario de quema · ${z}`,
  calendarAria: "Calendario de quema: meses por año, coloreados según la relación con el nivel habitual",
  year: "año",
  calNote: "Cada cuadro compara un mes con la mediana del mismo mes en 2002–2026. Los cuadros rayados (antes de feb 2012) están reconstruidos desde MODIS.",
  calFirstPct: (p) => ` (primer ${p}% del mes)`,
  calVsUsual: (r, m, med) => `×${r} respecto a un ${m} habitual (${med})`,
  translatedFrom: "traducido desde MODIS Aqua", observedBy: "observado por VIIRS",
  normalBin: "≈ normal",
  perYear: "Focos por año", harmonized: "Armonizado", rawSensors: "Sensores crudos",
  legendModisRaw: "MODIS crudo", legendViirsRaw: "VIIRS crudo",
  legendTranslated: "MODIS Aqua → equivalente VIIRS (± error)", legendObserved: "VIIRS observado",
  viirsStarts: "empieza VIIRS", julDec: " (jul–dic)", toDate: " (hasta hoy)",
  rawCount: "conteo crudo del sensor", harmonizedCount: "armonizado",
  modisTA: "MODIS Terra + Aqua", viirsSnpp: "VIIRS S-NPP",
  chartAria: (a, b, naive) => `Focos por año ${a}–${b}, ${naive ? "sensores crudos pegados" : "armonizado"}`,
  noteNaive: "Pegar los sensores crudos hace que el fuego parezca ~3 veces mayor después de 2012, pero ese salto es el cambio al sensor VIIRS, más sensible, no más fuego.",
  noteHarmonized: "Una sola unidad para 24 años: los conteos de MODIS antes de 2012 se traducen a lo que habría detectado VIIRS, con un factor por región y mes.",
  newTitle: "Fuego en lugares nuevos",
  newStat: (n, total, pct) => `${n} de ${total} focos (${pct}%) están en lugares sin fuego registrado a menos de ~1 km desde 2002.`,
  newNone: (total) => `Ninguno de los ${total} focos de este mes está en un lugar nuevo: todos caen donde ya hubo fuego.`,
  newOnly: "Mostrar solo focos en lugares nuevos",
  newUnavailable: "Los focos individuales están disponibles para los meses bajados de la API de FIRMS (2026). Elegí un mes de 2026 para ver dónde aparece fuego en lugares sin antecedentes.",
  newNote: "“Lugar nuevo”: ningún foco de ningún sensor en la misma celda de ~1 km ni en las vecinas, de julio 2002 a diciembre 2025. Estos focos merecen una mirada de cerca: desmonte nuevo, o fuego que llega a vegetación que no se había quemado antes.",
  download: "Descargar", dlSeries: "Serie mensual de esta área (CSV)",
  dlHotspots: (n, y) => `${n} focos de ${y} en esta área (CSV)`,
  footData: (last, to) => `Datos: NASA FIRMS — MODIS Colección 6.1 (Terra, Aqua) y VIIRS 375 m (S-NPP, NOAA-20), solo fuegos de vegetación. Meses hasta ${last} de los archivos de calidad científica; los siguientes, de la API de FIRMS${to ? ` (hasta ${to})` : ""}.`,
  footValidation: (a, b, c) => `Armonización probada con años escondidos: error mediano mensual de ${a}% para Paraguay, ${b}% para el Chaco y ${c}% para la Región Oriental.`,
  footHotspot: "Un foco es un píxel de ~375 m a 1 km con fuego activo al pasar el satélite, no un conteo de incendios. Aplicación hecha con asistencia de IA. NASA Space Apps Challenge 2026 · Asunción.",
  drawHint: "Hacé clic para agregar puntos · doble clic o Enter para terminar · Esc para cancelar",
  finish: (n) => `Terminar zona (${n} puntos)`,
  mapLegend: (m) => `Focos por celda de ~11 km · ${m}`,
  legendDots: (n) => `focos VIIRS individuales (${n})`,
  legendNew: (n) => `en un lugar nuevo (${n})`,
  popupCell: (m) => `${m} · celda de ~11 km`,
  step3: "3 · Elegí un rango de fechas",
  rangeFrom: "Desde", rangeTo: "Hasta",
  presets: { year: "Este año", last12: "Últimos 12 meses", season: "Temporada (jul–oct)", all: "Todo" },
  rangeTitle: (a, b) => `Análisis · ${a} – ${b}`,
  rangeTotal: (v, err) => `${v} focos${err}`,
  rangeVsTypical: (r, typ) => `×${r} de lo habitual para estos meses (típico ${typ})`,
  rangePeak: (m, v) => `Mes pico: ${m} (${v})`,
  rangeMonths: (hi, lo, n) => `${hi} de ${n} meses por encima de lo normal, ${lo} por debajo`,
  rangeNew: (n) => `${n} focos en lugares nuevos`,
  rangePartial: "incluye un mes en curso",
  calModeRatio: "vs normal", calModeCount: "Focos",
  typicalRow: "típico",
  calNoteCount: "Cada cuadro muestra la cantidad de focos armonizados. La fila “típico” es la mediana de cada mes: muestra cuándo es la temporada de fuego.",
  outOfRange: "fuera del rango elegido",
  dlSeriesRange: (a, b) => `Serie mensual ${a} – ${b} (CSV)`,
  dlHotspotsRange: (a, b) => `Focos individuales ${a} – ${b} en esta área (CSV)`,
  dlHotspotsEstimate: (n) => `≈ ${n} focos`,
  dlTooMany: (n) => `≈ ${n} focos: demasiados para un archivo. Achicá el área o el rango de fechas (límite ≈ 1,5 millones).`,
  dlPreparing: (a, b) => `Preparando… ${a}/${b} bloques`,
  dlReport: "Imagen de reporte: calendario, gráfico anual y análisis (PNG)",
  dlFailed: "Falló la descarga:",
  coords: "⌖ Coordenadas",
  coordsLat: "Latitud", coordsLon: "Longitud", coordsRadius: "Radio (km)", coordsApply: "Aplicar",
  coordsHelp: "Grados decimales, por ejemplo −22.35, −60.03. Dentro de Paraguay.",
  coordsInvalid: "Ingresá un punto dentro de Paraguay y un radio entre 5 y 300 km.",
  zoneCoords: (lat, lon, r) => `${r} km alrededor de ${lat}, ${lon}`,
  reportTitle: "¿Es normal este fuego? · Tata Rekavo",
  reportFooter: "Datos: NASA FIRMS (MODIS C6.1, VIIRS 375 m), armonizados a focos equivalentes VIIRS. tata-rekavo.vercel.app",
  catador: {
    partial: (p) => `ℹ️ Validación Física: mes en curso (${p}% de sus días). Se compara con la misma porción de un mes típico y todavía puede cambiar.`,
    highObserved: "🔥 Validación Física: claramente por encima de lo habitual, observado directamente por VIIRS (sin incertidumbre de traducción). Conviene contrastarlo con imágenes satelitales o reportes de campo.",
    highRobust: (lo) => `🔥 Validación Física: claramente por encima de lo habitual, incluso en el extremo bajo de la banda de error (×${lo}). Conviene contrastarlo con imágenes satelitales o reportes de campo.`,
    highUncertain: (lo, hi) => `⚠️ Validación Física: por encima de lo habitual, pero dentro de la banda de incertidumbre (×${lo}–×${hi}). Confirmar con imágenes satelitales antes de sacar conclusiones.`,
    lowRobust: "ℹ️ Validación Física: claramente por debajo de lo habitual. Menos focos no significa menos riesgo: la vegetación sin quemar puede acumularse.",
    lowUncertain: (lo, hi) => `ℹ️ Validación Física: posiblemente por debajo de lo habitual, dentro de la banda de incertidumbre (×${lo}–×${hi}).`,
    normal: "✅ Validación Física: dentro del rango habitual para este mes.",
    harmonizedBy: "🔄 Armonizado por Tata Rekavo",
    observedDirect: "🛰️ Observación directa VIIRS",
  },
  langLabel: "Language: English",
};

function ordinalEn(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const DICTS: Record<Lang, Dict> = { en, es };

export interface I18n {
  lang: Lang;
  t: Dict;
  num: (n: number) => string;
  ratio: (r: number) => string;
  monthShort: (month: number) => string;
  monthLong: (month: number) => string;
  monthLabel: (year: number, month: number) => string;
  initials: string[];
}

export function makeI18n(lang: Lang): I18n {
  const loc = lang === "es" ? "es-PY" : "en-US";
  return {
    lang, t: DICTS[lang],
    num: (n) => Math.round(n).toLocaleString(loc),
    ratio: (r) => r.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    monthShort: (m) => MONTHS_SHORT[lang][m - 1],
    monthLong: (m) => MONTHS_LONG[lang][m - 1],
    monthLabel: (y, m) => `${MONTHS_SHORT[lang][m - 1]} ${y}`,
    initials: INITIALS[lang],
  };
}

export const I18nContext = createContext<I18n>(makeI18n("en"));
export const useI18n = () => useContext(I18nContext);

export function initialLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "es" || q === "en") return q;
    const saved = window.localStorage.getItem("tata-rekavo-lang");
    if (saved === "es" || saved === "en") return saved;
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

export function saveLang(lang: Lang) {
  try { window.localStorage.setItem("tata-rekavo-lang", lang); } catch { /* ignore */ }
}
