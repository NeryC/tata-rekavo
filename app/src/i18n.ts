import { createContext, useContext } from "react";
import { monthDayOf, type SeasonSummary } from "./season";

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
  subtitle: "Tata Rekavo: 24 years of NASA fire hotspots over Paraguay in one harmonized record",
  method: "Method & validation", code: "Code",
  loading: "Loading 24 years of fire hotspots…", loadError: "Could not load the data:",
  step1: "Area", step2: "Month",
  zones: { paraguay: "Paraguay", chaco: "Chaco", oriental: "Oriental", draw: "✎ Draw" },
  zoneIn: { paraguay: "Paraguay", chaco: "the Chaco", oriental: "the Oriental region", custom: "your zone" },
  cellsArea: (_cells: string, km2: string) => `About ${km2} km²`,
  smallArea: "Small area: months before 2012 carry a larger error.",
  noCells: "Nothing inside this area. Draw a larger one.",
  inProgress: " (in progress)", prev: "Previous month", next: "Next month", monthAria: "Month",
  verdictWhen: (month: string, zone: string) => `${month} in ${zone}`,
  lastUpdated: (when: string) => `Data updated ${when} (Asunción time)`,
  staleData: "Data may be out of date",
  partialTag: (pct: number) => `Month in progress: data for ${pct}% of its days`,
  scale: { low: "Low", normal: "Normal", high: "High", extreme: "Extreme" } as Record<string, string>,
  scaleAria: (r: string) => `Position on the scale: ${r} times the usual level`,
  ofUsual: "of the usual level",
  classes: { low: "Below normal", normal: "Normal", high: "High", extreme: "Extreme" } as Record<string, string>,
  hotspots: "hotspots",
  usualIs: (m: string, partial: boolean) => (partial ? `The usual for this part of ${m} is` : `The usual for ${m} is`),
  medianOf: (n: number) => `(median of ${n} previous years).`,
  whatIsHotspot: "What is a hotspot?",
  hotspotDef: "A satellite pixel, 375 m to 1 km wide, with active fire when the satellite passed. One fire can produce many hotspots, and clouds can hide them.",
  rank: (r: number, m: string, total: number) => (r === total ? `Lowest ${m} out of ${total} on record.`
    : r > total / 2 ? `${ordinalEn(total - r + 1)} lowest ${m} out of ${total} on record.`
    : `${r === 1 ? "Highest" : `${ordinalEn(r)} highest`} ${m} out of ${total} on record.`),
  source: "Source:",
  srcTranslated: "MODIS Aqua, translated to VIIRS-equivalent",
  srcObserved: "VIIRS S-NPP observed (outage days filled with NOAA-20)",
  nrt: "near real-time", days: "days",
  rangeKey: "Underlined: the period you are analyzing",
  calendarTitle: (z: string) => `Burning calendar for ${z}`,
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
  seasonTitle: (z: string) => `Season so far in ${z}`,
  seasonAria: (year: number, y0: number | null, y1: number | null) => `Cumulative hotspots through ${year}${y0 === null ? "" : ` against the usual range of ${y0}–${y1}`}`,
  seasonLegendBand: "Usual range (10th–90th percentile)", seasonLegendMedian: "Median year", seasonLastData: "last data",
  seasonYearCount: (year: number) => `${year} so far`, seasonMedianCount: "Median", seasonRangeCount: "Usual range",
  seasonNoData: "no data", seasonNoDataDay: "no satellite data this day, the curve stays flat",
  seasonStatus: (s: SeasonSummary, date: (doy: number) => string) => {
    if (s.kind === "early") return "Too early in the year to compare with a normal season.";
    if (s.kind === "none") return "No hotspots yet, and the median for this date is also zero.";
    if (s.dir === "same" && s.reach?.when === "onTime") return "In line with a typical year at this date.";
    const head = s.dir === "same" ? "In line with the usual level at this date"
      : s.pct === null ? "Above the usual level at this date"
      : `${s.pct} % ${s.dir === "above" ? "above" : "below"} the usual level at this date`;
    if (!s.reach) return `${head}.`;
    if (s.reach.when === "onTime") return `${head}; in line with a typical year.`;
    return `${head}; a typical year ${s.reach.when === "future" ? "only reaches" : "reached"} this total on ${date(s.reach.doy)}.`;
  },
  seasonNoClim: "No usual curve for this area: it is custom, or has no season history yet. Only this year's curve is shown.",
  seasonCaption: "Both curves are cumulative hotspots from 1 January, in VIIRS S-NPP-equivalent units.",
  seasonCaptionRange: (y0: number, y1: number) => ` Usual range: ${y0}–${y1}.`,
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
  trustTitle: "How reliable is this?",
  trustIntro: "Before releasing it, the harmonization was tested year by year: each year from 2012 to 2025 was held out in turn, its MODIS Aqua counts were translated to the VIIRS scale (Aqua×f), and the result was compared with what S-NPP actually observed.",
  trustArea: "Area",
  trustError: "Median monthly error",
  trustClass: "Same level as observed (low / normal / high / extreme)",
  trustSpearman: (rho: string, n: string) => `How unusual each month is compared with the same calendar month, ranked in Paraguay: Spearman correlation ${rho} between the translated and the observed record, over ${n} months.`,
  trustRecent: "Months from February 2012 onward, observed directly by VIIRS, carry no translation error.",
  trustEarly: "Months before 2012 are estimates translated from MODIS; the ± shown next to the count in the verdict is their modelled error.",
  trustOpen: "Open full size", opensNewTab: "(opens in a new tab)",
  validationAlt: "Validation figure in three panels. Left: the naive annual hotspot record, where MODIS and VIIRS levels do not match. Centre: the harmonized annual record with error bars, where both join smoothly. Right: scatter of hold-out region-months for the Chaco and the Oriental region, predicted from Aqua against observed, falling close to the diagonal.",
  footHotspot: "AI-assisted application. NASA Space Apps Challenge 2026, Asunción.",
  aboutData: "About the data",
  rankingTitle: (m: string) => `Where is fire abnormal in ${m}?`,
  rankingIntro: "Departments ranked by how far this month is above or below their own usual level. Pick one to see it on the map.",
  rankingAria: "Departments ranked by anomaly",
  rankingCounts: (v: string, med: string) => `${v} hotspots · usual ${med}`,
  rankingCountsLow: (v: string) => `${v} hotspots`,
  lowSignal: "Too little fire history in this month to compare against (a typical month has fewer than 10 hotspots), so a ratio would not be meaningful. Shown by hotspot count only.",
  lowSignalTag: "Low signal",
  partialShort: "partial",
  rankingShowAll: (n: number) => `Show all ${n} departments`,
  rankingShowTop: (n: number) => `Show only the top ${n}`,
  zoneDept: (name: string) => `${name} department`,
  depActive: (name: string) => `Department selected: ${name}`,
  partnerTitle: "Space Agency Partner & Other Data",
  footBoundaries: (retrieved: string | null) => `Department boundaries: geoBoundaries gbOpen, Paraguay ADM1 (original source: DGEEC Paraguay), licence CC BY 4.0${retrieved ? `, retrieved ${retrieved}` : ""}. Runfola et al. (2020), geoBoundaries: A global database of political administrative boundaries. PLoS ONE 15(4): e0231866.`,
  newWhat: "What counts as a new place?",
  drawHint: "Click the map to add points. Double-click or press Enter to finish.",
  finish: (n: number) => `Finish zone (${n} pts)`,
  mapLegend: (m: string) => `Hotspots per ~11 km cell, ${m}`,
  legendDots: (n: string) => `individual VIIRS hotspots (${n})`,
  legendNew: (n: string) => `in a new place (${n})`,
  popupCell: (m: string) => `${m}, ~11 km cell`,
  // --- range, analytics, calendar modes, export, coordinates
  step3: "Analyze a period",
  rangeFrom: "From", rangeTo: "To",
  presets: { year: "This year", last12: "Last 12 months", season: "Fire season (Jul–Oct)", all: "All" } as Record<string, string>,
  rangeTitle: (a: string, b: string, z: string) => `${a} to ${b} in ${z}`,
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
  dlSeriesRange: (a: string, b: string) => `Monthly series, ${a} to ${b} (CSV)`,
  dlHotspotsRange: (a: string, b: string) => `Every hotspot, ${a} to ${b} (CSV)`,
  dlHotspotsEstimate: (n: string) => `≈ ${n} hotspots`,
  dlTooMany: (n: string) => `≈ ${n} hotspots: too many for one file. Narrow the area or the date range (limit ≈ 1.5 million).`,
  dlPreparing: (a: number, b: number) => `Preparing… ${a}/${b} blocks`,
  dlReport: "Report image with calendar and charts (PNG)",
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
  areaPresets: "Predefined areas", customArea: "Or define your own:", drawTool: "Draw on the map", coordsTool: "By coordinates",
  zoomIn: "Zoom in", zoomOut: "Zoom out", resetNorth: "Reset north and tilt",
  resetView: "Back to the selected area", undoPoint: "Undo point", cancel: "Cancel",
  resetArea: "↺ Back to Paraguay", resetMonth: "↺ Current month", resetRange: "↺ Reset",
  resetAll: "↺ Reset all", resetAllTitle: "Back to the start: Paraguay, current month, this year",
  copyLink: "Copy link", copyLinkTitle: "Copy a link to this exact view", linkCopied: "Link copied", linkCopyManual: "Copy this link",
  langLabel: "Idioma: español",
  metricLabel: "Measure", metricHelpTitle: "Hotspots or fire power?",
  metricCount: "Hotspots", metricFrp: "Fire power (FRP)",
  metricHelp: "Hotspots counts the pixels where the satellite saw fire. Fire power (FRP) adds up how much heat those fires radiate, in megawatts (MW): a big fire weighs more than a small one.",
  metricLoading: "Loading fire power data…",
  metricUnavailable: "Fire power data could not be loaded, so only hotspots are available.",
  experimentalTag: "Experimental",
  experimentalNote: "Experimental: the fire power translation is less accurate than the hotspot one. Read the validation before relying on it.",
  frpNoData: (month: string) => `No fire power data for ${month} yet: the daily file for that month was written before it included FRP. The hotspot count is available under “Hotspots”.`,
  frpNoDataShort: "no FRP data",
  calNoData: "No FRP data for this month yet",
  yearNoData: (n: number) => `${n} month${n === 1 ? "" : "s"} without FRP data, not counted`,
  rangeNoData: (n: number) => `${n} month${n === 1 ? "" : "s"} without FRP data, left out of the total`,
  seasonCountsOnly: "The season curve counts hotspots. Switch to “Hotspots” to see it.",
  trustP90: "Error in 9 of 10 months (at most)",
  trustExtra: "",
};
export type Dict = typeof en;

/** What changes when the measure is fire power (MW) instead of hotspot counts; merged over the dictionary by makeI18n. */
const frpEn: Partial<Dict> = {
  hotspots: "MW",
  whatIsHotspot: "What is fire power (FRP)?",
  hotspotDef: "Fire radiative power: the heat a fire radiates at the moment the satellite passes, in megawatts (MW), measured per hotspot. The monthly figure adds it up over the area, so one intense fire counts more than a small one. Like hotspots, clouds can hide it.",
  perYear: "Fire power per year (MW)",
  harmonizedCount: "harmonized, MW",
  chartAria: (a: number, b: number) => `Fire power in megawatts per year ${a}–${b}, harmonized`,
  noteHarmonized: "One unit for 24 years: MODIS fire power before 2012 is translated to what VIIRS would have measured, with a factor per region and calendar month. The factors are ratios of sums, so one extreme hotspot cannot tilt them.",
  calNoteCount: "Each square shows the harmonized fire power in MW. The “typical” row is the median of each month: it shows when the fire season happens.",
  calModeCount: "MW",
  rankingCounts: (v: string, med: string) => `${v} MW · usual ${med}`,
  rankingCountsLow: (v: string) => `${v} MW`,
  lowSignal: "Too little fire history in this month to compare against (a typical month has less than 100 MW), so a ratio would not be meaningful. Shown by fire power only.",
  mapLegend: (m: string) => `Fire power (MW) per ~11 km cell, ${m}`,
  rangeTotal: (v: string, err: string) => `${v} MW${err}`,
  rangePeak: (m: string, v: string) => `Peak month: ${m} (${v} MW)`,
  dlSeries: "Monthly fire power for this area (CSV)",
  dlSeriesRange: (a: string, b: string) => `Monthly fire power (MW), ${a} to ${b} (CSV)`,
  footValidation: (a: number, b: number, c: number) => `Fire power harmonization tested on held-out years: median monthly error ${a}% for Paraguay, ${b}% for the Chaco and ${c}% for the Oriental region.`,
  trustIntro: "Before releasing it, the fire power translation was tested year by year: each year from 2012 to 2025 was held out in turn, its MODIS Aqua fire power was translated to the VIIRS scale (Aqua×f), and the result was compared with the fire power S-NPP actually measured, in months with at least 1 MW.",
  trustEarly: "Months before 2012 are estimates translated from MODIS; the ± shown next to the MW figure in the verdict is their modelled error.",
  trustExtra: "The translation factors are ratios of summed fire power, and the error is reported as the median and as the 90th percentile, so one extreme month or one 5,000 MW hotspot cannot hide or dominate it. Bias is the average signed error: near zero means no systematic over- or under-estimate.",
  reportFooter: "Data: NASA FIRMS (MODIS C6.1, VIIRS 375 m), fire radiative power harmonized to VIIRS-equivalent MW. tata-rekavo.vercel.app",
  catador: { ...en.catador, lowRobust: "ℹ️ Physical check: clearly below usual. Less fire power does not mean lower fire risk: unburned vegetation can build up." },
};

const es: Dict = {
  title: "¿Es normal este fuego?",
  subtitle: "Tata Rekavo: 24 años de focos de calor de la NASA sobre Paraguay en un solo registro armonizado",
  method: "Método y validación", code: "Código",
  loading: "Cargando 24 años de focos de calor…", loadError: "No se pudieron cargar los datos:",
  step1: "Área", step2: "Mes",
  zones: { paraguay: "Paraguay", chaco: "Chaco", oriental: "Oriental", draw: "✎ Dibujar" },
  zoneIn: { paraguay: "Paraguay", chaco: "el Chaco", oriental: "la Región Oriental", custom: "tu zona" },
  cellsArea: (_cells, km2) => `Unos ${km2} km²`,
  smallArea: "Área chica: los meses anteriores a 2012 tienen más error.",
  noCells: "No hay nada dentro de esta área. Dibujá una más grande.",
  inProgress: " (en curso)", prev: "Mes anterior", next: "Mes siguiente", monthAria: "Mes",
  verdictWhen: (month, zone) => `${month} en ${zone}`,
  lastUpdated: (when) => `Datos actualizados el ${when} (hora de Asunción)`,
  staleData: "Los datos pueden estar desactualizados",
  partialTag: (pct) => `Mes en curso: datos del ${pct}% de sus días`,
  scale: { low: "Bajo", normal: "Normal", high: "Alto", extreme: "Extremo" },
  scaleAria: (r) => `Posición en la escala: ${r} veces el nivel habitual`,
  ofUsual: "del nivel habitual",
  classes: { low: "Por debajo de lo normal", normal: "Normal", high: "Alto", extreme: "Extremo" },
  hotspots: "focos",
  usualIs: (m, partial) => (partial ? `Lo habitual para esta parte de ${m} son` : `Lo habitual en ${m} son`),
  medianOf: (n) => `(mediana de ${n} años anteriores).`,
  whatIsHotspot: "¿Qué es un foco?",
  hotspotDef: "Un píxel satelital, de 375 m a 1 km de lado, con fuego activo en el momento en que pasó el satélite. Un mismo incendio puede generar muchos focos, y las nubes pueden taparlos.",
  rank: (r, m, total) => (r === total ? `El ${m} más bajo de ${total} registrados.`
    : r > total / 2 ? `El ${total - r + 1}.º ${m} más bajo de ${total} registrados.`
    : `${r === 1 ? "El" : `El ${r}.º`} ${m} más alto de ${total} registrados.`),
  source: "Fuente:",
  srcTranslated: "MODIS Aqua, traducido a equivalente VIIRS",
  srcObserved: "VIIRS S-NPP observado (días de corte rellenados con NOAA-20)",
  nrt: "tiempo casi real", days: "días",
  rangeKey: "Subrayado: el período que estás analizando",
  calendarTitle: (z) => `Calendario de quema en ${z}`,
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
  seasonTitle: (z) => `Temporada hasta hoy en ${z}`,
  seasonAria: (year, y0, y1) => `Focos acumulados hasta ${year}${y0 === null ? "" : ` frente al rango habitual de ${y0}–${y1}`}`,
  seasonLegendBand: "Rango habitual (percentil 10–90)", seasonLegendMedian: "Año mediano", seasonLastData: "último dato",
  seasonYearCount: (year) => `${year} hasta hoy`, seasonMedianCount: "Mediana", seasonRangeCount: "Rango habitual",
  seasonNoData: "sin datos", seasonNoDataDay: "sin datos de satélite este día, la curva queda plana",
  seasonStatus: (s, date) => {
    if (s.kind === "early") return "Es muy temprano en el año para comparar con una temporada normal.";
    if (s.kind === "none") return "Todavía no hay focos, y la mediana para esta fecha también es cero.";
    if (s.dir === "same" && s.reach?.when === "onTime") return "En línea con un año típico a esta fecha.";
    const head = s.dir === "same" ? "En línea con lo normal a esta fecha"
      : s.pct === null ? "Por encima de lo normal a esta fecha"
      : `${s.pct} % ${s.dir === "above" ? "por encima" : "por debajo"} de lo normal a esta fecha`;
    if (!s.reach) return `${head}.`;
    if (s.reach.when === "onTime") return `${head}; en línea con un año típico.`;
    return `${head}; un año típico ${s.reach.when === "future" ? "recién alcanza" : "alcanzó"} este total el ${date(s.reach.doy)}.`;
  },
  seasonNoClim: "No hay curva habitual para esta área: es personalizada o todavía no tiene historia de temporada. Solo se muestra la curva de este año.",
  seasonCaption: "Ambas curvas son focos acumulados desde el 1 de enero, en unidades equivalentes a VIIRS S-NPP.",
  seasonCaptionRange: (y0, y1) => ` Rango habitual: ${y0}–${y1}.`,
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
  trustTitle: "¿Qué tan confiable es esto?",
  trustIntro: "Antes de publicarla, la armonización se probó año por año: se escondió cada año de 2012 a 2025, se tradujeron sus conteos de MODIS Aqua a la escala de VIIRS (Aqua×f) y se comparó el resultado con lo que S-NPP realmente observó.",
  trustArea: "Área",
  trustError: "Error mediano mensual",
  trustClass: "Mismo nivel que lo observado (bajo / normal / alto / extremo)",
  trustSpearman: (rho, n) => `Qué tan inusual es cada mes frente al mismo mes del calendario, ordenado en Paraguay: correlación de Spearman ${rho} entre el registro traducido y el observado, sobre ${n} meses.`,
  trustRecent: "Los meses desde febrero de 2012, observados directamente por VIIRS, no llevan error de traducción.",
  trustEarly: "Los meses anteriores a 2012 son estimaciones traducidas desde MODIS; el ± junto al conteo en el veredicto es su error modelado.",
  trustOpen: "Ver en tamaño completo", opensNewTab: "(se abre en otra pestaña)",
  validationAlt: "Figura de validación en tres paneles. Izquierda: el registro anual ingenuo de focos, donde los niveles de MODIS y VIIRS no coinciden. Centro: el registro anual armonizado con barras de error, donde ambos empalman sin salto. Derecha: dispersión de meses-región escondidos del Chaco y la Región Oriental, predichos desde Aqua contra lo observado, cerca de la diagonal.",
  footHotspot: "Aplicación hecha con asistencia de IA. NASA Space Apps Challenge 2026, Asunción.",
  aboutData: "Sobre los datos",
  rankingTitle: (m) => `¿Dónde hay fuego anormal en ${m}?`,
  rankingIntro: "Departamentos ordenados según cuánto se aparta este mes de su propio nivel habitual. Elegí uno para verlo en el mapa.",
  rankingAria: "Departamentos ordenados por anomalía",
  rankingCounts: (v, med) => `${v} focos · habitual ${med}`,
  rankingCountsLow: (v) => `${v} focos`,
  lowSignal: "Hay muy poco historial de fuego en este mes para comparar (un mes típico tiene menos de 10 focos), así que un cociente no sería significativo. Se muestra solo el número de focos.",
  lowSignalTag: "Poca señal",
  partialShort: "parcial",
  rankingShowAll: (n) => `Ver los ${n} departamentos`,
  rankingShowTop: (n) => `Ver solo los ${n} primeros`,
  zoneDept: (name) => `el departamento de ${name}`,
  depActive: (name) => `Departamento seleccionado: ${name}`,
  partnerTitle: "Space Agency Partner & Other Data",
  footBoundaries: (retrieved) => `Límites departamentales: geoBoundaries gbOpen, Paraguay ADM1 (fuente original: DGEEC Paraguay), licencia CC BY 4.0${retrieved ? `, obtenidos el ${retrieved}` : ""}. Runfola et al. (2020), geoBoundaries: A global database of political administrative boundaries. PLoS ONE 15(4): e0231866.`,
  newWhat: "¿Qué cuenta como lugar nuevo?",
  drawHint: "Hacé clic en el mapa para agregar puntos. Doble clic o Enter para terminar.",
  finish: (n) => `Terminar zona (${n} puntos)`,
  mapLegend: (m) => `Focos por celda de ~11 km, ${m}`,
  legendDots: (n) => `focos VIIRS individuales (${n})`,
  legendNew: (n) => `en un lugar nuevo (${n})`,
  popupCell: (m) => `${m}, celda de ~11 km`,
  step3: "Analizar un período",
  rangeFrom: "Desde", rangeTo: "Hasta",
  presets: { year: "Este año", last12: "Últimos 12 meses", season: "Temporada (jul–oct)", all: "Todo" },
  rangeTitle: (a, b, z) => `${a} a ${b} en ${z}`,
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
  dlSeriesRange: (a, b) => `Serie mensual, ${a} a ${b} (CSV)`,
  dlHotspotsRange: (a, b) => `Todos los focos, ${a} a ${b} (CSV)`,
  dlHotspotsEstimate: (n) => `≈ ${n} focos`,
  dlTooMany: (n) => `≈ ${n} focos: demasiados para un archivo. Achicá el área o el rango de fechas (límite ≈ 1,5 millones).`,
  dlPreparing: (a, b) => `Preparando… ${a}/${b} bloques`,
  dlReport: "Imagen de reporte con calendario y gráficos (PNG)",
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
  areaPresets: "Áreas predefinidas", customArea: "O definí la tuya:", drawTool: "Dibujar en el mapa", coordsTool: "Por coordenadas",
  zoomIn: "Acercar", zoomOut: "Alejar", resetNorth: "Volver al norte y quitar inclinación",
  resetView: "Volver al área elegida", undoPoint: "Deshacer punto", cancel: "Cancelar",
  resetArea: "↺ Volver a Paraguay", resetMonth: "↺ Mes actual", resetRange: "↺ Restablecer",
  resetAll: "↺ Restablecer todo", resetAllTitle: "Volver al inicio: Paraguay, mes actual, este año",
  copyLink: "Copiar enlace", copyLinkTitle: "Copiar un enlace a esta vista exacta", linkCopied: "Enlace copiado", linkCopyManual: "Copiá este enlace",
  langLabel: "Language: English",
  metricLabel: "Medida", metricHelpTitle: "¿Focos o potencia del fuego?",
  metricCount: "Focos", metricFrp: "Potencia del fuego (FRP)",
  metricHelp: "Focos cuenta los píxeles donde el satélite vio fuego. La potencia del fuego (FRP) suma cuánto calor irradian esos fuegos, en megavatios (MW): un incendio grande pesa más que uno chico.",
  metricLoading: "Cargando datos de potencia del fuego…",
  metricUnavailable: "No se pudieron cargar los datos de potencia del fuego, así que solo están disponibles los focos.",
  experimentalTag: "Experimental",
  experimentalNote: "Experimental: la traducción de la potencia del fuego es menos precisa que la de los focos. Leé la validación antes de apoyarte en ella.",
  frpNoData: (month) => `Todavía no hay datos de potencia del fuego para ${month}: el archivo diario de ese mes se escribió antes de incluir la FRP. El conteo de focos está disponible en “Focos”.`,
  frpNoDataShort: "sin datos de FRP",
  calNoData: "Todavía no hay datos de FRP para este mes",
  yearNoData: (n) => `${n} ${n === 1 ? "mes" : "meses"} sin datos de FRP, no contados`,
  rangeNoData: (n) => `${n} ${n === 1 ? "mes" : "meses"} sin datos de FRP, fuera del total`,
  seasonCountsOnly: "La curva de temporada cuenta focos. Cambiá a “Focos” para verla.",
  trustP90: "Error en 9 de cada 10 meses (como máximo)",
  trustExtra: "",
};

/** Lo que cambia cuando la medida es la potencia del fuego (MW) en vez del conteo de focos. */
const frpEs: Partial<Dict> = {
  hotspots: "MW",
  whatIsHotspot: "¿Qué es la potencia del fuego (FRP)?",
  hotspotDef: "Potencia radiativa del fuego: el calor que irradia un fuego cuando pasa el satélite, en megavatios (MW), medida en cada foco. La cifra mensual la suma sobre el área, así que un fuego intenso cuenta más que uno chico. Igual que los focos, las nubes pueden taparla.",
  perYear: "Potencia del fuego por año (MW)",
  harmonizedCount: "armonizado, MW",
  chartAria: (a, b) => `Potencia del fuego en megavatios por año ${a}–${b}, armonizada`,
  noteHarmonized: "Una sola unidad para 24 años: la potencia de MODIS antes de 2012 se traduce a lo que habría medido VIIRS, con un factor por región y mes. Los factores son cocientes de sumas, así que un solo foco extremo no los puede torcer.",
  calNoteCount: "Cada cuadro muestra la potencia del fuego armonizada en MW. La fila “típico” es la mediana de cada mes: muestra cuándo es la temporada de fuego.",
  calModeCount: "MW",
  rankingCounts: (v, med) => `${v} MW · habitual ${med}`,
  rankingCountsLow: (v) => `${v} MW`,
  lowSignal: "Hay muy poco historial de fuego en este mes para comparar (un mes típico tiene menos de 100 MW), así que un cociente no sería significativo. Se muestra solo la potencia del fuego.",
  mapLegend: (m) => `Potencia del fuego (MW) por celda de ~11 km, ${m}`,
  rangeTotal: (v, err) => `${v} MW${err}`,
  rangePeak: (m, v) => `Mes pico: ${m} (${v} MW)`,
  dlSeries: "Potencia del fuego mensual de esta área (CSV)",
  dlSeriesRange: (a, b) => `Potencia del fuego mensual (MW), ${a} a ${b} (CSV)`,
  footValidation: (a, b, c) => `Armonización de la potencia del fuego probada con años escondidos: error mediano mensual de ${a}% para Paraguay, ${b}% para el Chaco y ${c}% para la Región Oriental.`,
  trustIntro: "Antes de publicarla, la traducción de la potencia del fuego se probó año por año: se escondió cada año de 2012 a 2025, se tradujo su potencia de MODIS Aqua a la escala de VIIRS (Aqua×f) y se comparó el resultado con la potencia que S-NPP realmente midió, en meses con al menos 1 MW.",
  trustEarly: "Los meses anteriores a 2012 son estimaciones traducidas desde MODIS; el ± junto a la cifra en MW en el veredicto es su error modelado.",
  trustExtra: "Los factores de traducción son cocientes de potencia sumada y el error se informa como mediana y como percentil 90, así que un mes extremo o un solo foco de 5.000 MW no lo puede ocultar ni dominar. El sesgo es el error promedio con signo: cerca de cero significa que no hay sobre- ni subestimación sistemática.",
  reportFooter: "Datos: NASA FIRMS (MODIS C6.1, VIIRS 375 m), potencia radiativa del fuego armonizada a MW equivalentes de VIIRS. tata-rekavo.vercel.app",
  catador: { ...es.catador, lowRobust: "ℹ️ Validación Física: claramente por debajo de lo habitual. Menos potencia del fuego no significa menor riesgo: la vegetación sin quemar puede acumularse." },
};

function ordinalEn(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const DICTS: Record<Lang, Dict> = { en, es };

export type Metric = "count" | "frp";
/** The dictionary for a language and measure: with fire power (MW) the wording of units and help changes. */
export const dictFor = (lang: Lang, metric: Metric): Dict => (metric === "frp" ? { ...DICTS[lang], ...(lang === "es" ? frpEs : frpEn) } : DICTS[lang]);

export interface I18n {
  lang: Lang;
  metric: Metric;
  t: Dict;
  num: (n: number) => string;
  ratio: (r: number) => string;
  monthShort: (month: number) => string;
  monthLong: (month: number) => string;
  monthLabel: (year: number, month: number) => string;
  monthLongLabel: (year: number, month: number) => string;
  /** a day of the 365-day season calendar as "9 Aug" / "9 de agosto" */
  doyLabel: (doy: number) => string;
  initials: string[];
}

export function makeI18n(lang: Lang, metric: Metric = "count"): I18n {
  const loc = lang === "es" ? "es-PY" : "en-US";
  return {
    lang, metric, t: dictFor(lang, metric),
    num: (n) => Math.round(n).toLocaleString(loc),
    ratio: (r) => r.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    monthShort: (m) => MONTHS_SHORT[lang][m - 1],
    monthLong: (m) => MONTHS_LONG[lang][m - 1],
    monthLabel: (y, m) => `${MONTHS_SHORT[lang][m - 1]} ${y}`,
    monthLongLabel: (y, m) => (lang === "es"
      ? `${MONTHS_LONG.es[m - 1][0].toUpperCase()}${MONTHS_LONG.es[m - 1].slice(1)} de ${y}`
      : `${MONTHS_LONG.en[m - 1]} ${y}`),
    doyLabel: (doy) => {
      const { month, day } = monthDayOf(doy);
      return lang === "es" ? `${day} de ${MONTHS_LONG.es[month - 1]}` : `${day} ${MONTHS_SHORT.en[month - 1]}`;
    },
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
