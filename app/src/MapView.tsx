import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Grid } from "@core";
import { cellPolygon, type Hotspot } from "./data";
import type { I18n } from "./i18n";
import { describeHotspot } from "./hotspotTime";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// MapLibre 6 looks for its worker next to the library file; after bundling it lives in /assets
maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#efeee9" } }],
};

// sequential warm ramp for hotspot counts per cell-month (magnitude, one hue family)
export const CELL_RAMP: [number, string][] = [[1, "#fde5c8"], [10, "#f9b36e"], [50, "#ee7a2c"], [200, "#c9461a"], [1000, "#7f1d0a"]];
// same colours for fire power in MW per cell-month, which runs about ten times higher than the counts
export const FRP_RAMP: [number, string][] = [[5, "#fde5c8"], [50, "#f9b36e"], [250, "#ee7a2c"], [1000, "#c9461a"], [5000, "#7f1d0a"]];
const rampExpr = (ramp: [number, string][]) => {
  const e: unknown[] = ["interpolate", ["linear"], ["get", "v"]];
  ramp.forEach(([v, c]) => e.push(v, c));
  return e as maplibregl.ExpressionSpecification;
};
const rampLabel = (v: number, last: boolean) => `${v >= 1000 ? `${v / 1000}k` : v}${last ? "+" : ""}`;

interface Props {
  grid: Grid;
  monthLabel: string;
  values: Map<number, number>;
  /** what the cell values mean: hotspot counts or fire power (MW); picks the colour ramp */
  metric: "count" | "frp";
  zone: Set<number>;
  zoneBBox: [number, number, number, number];
  /** the country's bbox: the first framing, before the zone is known */
  countryBBox: [number, number, number, number];
  /** "fire in new places" is available (burn history loaded): only then the legend counts hotspots in new places */
  showNew: boolean;
  /** changes whenever the app asks the map to go back to the zone view */
  viewNonce: number;
  /** the selected zone's outline (a department boundary or the drawn polygon), if it has one */
  outline: GeoJSON.Geometry | null;
  hotspots: Hotspot[];
  /** the period of the points when it is not the selected month ("last 24 hours"); undefined for the month */
  pointsPeriod?: string;
  /** the country's time zone, for the local time of a selected hotspot */
  timeZone: string;
  newOnly: boolean;
  i18n: I18n;
  drawing: boolean;
  onDrawn: (ring: number[][]) => void;
  onCancelDraw: () => void;
  /** the map was panned, zoomed, rotated or tilted away from the area's framing */
  onUserMove: () => void;
  /** the map is back on the area's own framing */
  onViewReset: () => void;
  /** share a hotspot for verification (from its popup) */
  onShareHotspot: (h: { lat: number; lon: number; date: string; at: string | null }) => void;
  /** a hotspot opened from a shared link: centred and ringed on the map */
  focus: { lat: number; lon: number } | null;
}

type GJ = GeoJSON.FeatureCollection;
const empty: GJ = { type: "FeatureCollection", features: [] };

export default function MapView(p: Props) {
  const { t, num } = p.i18n;
  const nNew = p.hotspots.filter((h) => h.fresh).length;
  // cell size in the legend and the popup, from the grid (0.1 degree ~ 11 km in Paraguay, 0.25 degree ~ 28 km in Bolivia)
  const cellKm = Math.round(p.grid.meta.grid.deg * 111.32);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [baseUnavailable, setBaseUnavailable] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const homeBtn = useRef<HTMLButtonElement | null>(null);
  const [draft, setDraft] = useState<number[][]>([]);
  const draftRef = useRef<number[][]>([]);
  const props = useRef(p);
  props.current = p;

  // create the map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let style: maplibregl.StyleSpecification | string = FALLBACK_STYLE;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(STYLE_URL, { signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) style = STYLE_URL;
      } catch { /* offline: plain background */ }
      if (cancelled || !box.current) return;
      setBaseUnavailable(style === FALLBACK_STYLE);
      const m = new maplibregl.Map({
        container: box.current, style, bounds: props.current.countryBBox,
        fitBoundsOptions: { padding: 24 }, attributionControl: { compact: true },
        // on phones the page scrolls: one finger scrolls the page, two fingers move the map
        cooperativeGestures: window.matchMedia("(max-width: 860px)").matches,
        locale: {
          "NavigationControl.ZoomIn": props.current.i18n.t.zoomIn,
          "NavigationControl.ZoomOut": props.current.i18n.t.zoomOut,
          "NavigationControl.ResetBearing": props.current.i18n.t.resetNorth,
        },
      });
      // zoom + compass: the compass rotates with the map; clicking it points north and removes the tilt
      m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
      // home button: back to the selected area, north up, no tilt
      const home: maplibregl.IControl = {
        onAdd: () => {
          const div = document.createElement("div");
          div.className = "maplibregl-ctrl maplibregl-ctrl-group";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ctrl-home";
          btn.textContent = "⌂";
          btn.title = btn.ariaLabel = props.current.i18n.t.resetView;
          btn.onclick = () => resetView();
          div.appendChild(btn);
          homeBtn.current = btn;
          return div;
        },
        onRemove: () => { homeBtn.current = null; },
      };
      m.addControl(home, "top-right");
      m.on("load", () => {
        m.addSource("cells", { type: "geojson", data: empty });
        m.addSource("zone", { type: "geojson", data: empty });
        m.addSource("draft", { type: "geojson", data: empty });
        m.addSource("hotspots", { type: "geojson", data: empty });
        m.addSource("focus", { type: "geojson", data: empty });
        m.addLayer({
          id: "cells", type: "fill", source: "cells",
          paint: {
            "fill-color": rampExpr(props.current.metric === "frp" ? FRP_RAMP : CELL_RAMP),
            "fill-opacity": ["case", ["<=", ["get", "v"], 0], 0, ["==", ["get", "sel"], 1], 0.85, 0.22],
          },
        });
        m.addLayer({ id: "hotspots", type: "circle", source: "hotspots", filter: ["==", ["get", "fresh"], 0],
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.8, 9, 4], "circle-color": "#3d0c02",
                   "circle-opacity": 0.75 } });
        // hotspots in places with no fire on record within ~1 km: drawn on top, larger, in a contrasting hue
        m.addLayer({ id: "hotspots-new", type: "circle", source: "hotspots", filter: ["==", ["get", "fresh"], 1],
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 9, 7], "circle-color": "#2a78d6",
                   "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 } });
        m.addLayer({ id: "focus", type: "circle", source: "focus",
          paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#0b0b0b", "circle-stroke-width": 2.5 } });
        m.addLayer({ id: "zone", type: "line", source: "zone",
          paint: { "line-color": "#0b0b0b", "line-width": 2, "line-dasharray": [2, 1.5] } });
        m.addLayer({ id: "draft-line", type: "line", source: "draft", filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#2a78d6", "line-width": 2 } });
        m.addLayer({ id: "draft-pts", type: "circle", source: "draft", filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#2a78d6", "circle-stroke-width": 2 } });

        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
        m.on("mousemove", "cells", (e) => {
          if (props.current.drawing) return;
          const f = e.features?.[0];
          if (!f) return;
          // over a hotspot its own popup wins
          if (m.queryRenderedFeatures(e.point, { layers: ["hotspots", "hotspots-new"] }).length) { popup.remove(); return; }
          m.getCanvas().style.cursor = "default";
          popup.setLngLat(e.lngLat)
            .setHTML(`<b>${props.current.i18n.num(Number(f.properties.v))}</b> ${props.current.i18n.t.hotspots}<br><span>${props.current.i18n.t.popupCell(props.current.monthLabel, Math.round(props.current.grid.meta.grid.deg * 111.32))}</span>`)
            .addTo(m);
        });
        m.on("mouseleave", "cells", () => popup.remove());
        // a hotspot: when, with which sensor and from which product it was detected (hover with a mouse, tap on touch)
        // closed by its button or a click away from the points: closeOnClick would also close it on the click that opens it
        const hotspotPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 8, className: "hs-popup" });
        m.on("click", (e) => {
          if (!m.queryRenderedFeatures(e.point, { layers: ["hotspots", "hotspots-new"] }).length) hotspotPopup.remove();
        });
        const showHotspot = (e: maplibregl.MapLayerMouseEvent) => {
          if (props.current.drawing) return;
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const q = f.properties as Record<string, string>;
          const nul = (v: string | undefined) => (v === undefined || v === "" || v === "null" ? null : v);
          const { t, lang } = props.current.i18n;
          const d = describeHotspot({ date: q.date, at: nul(q.at), satellite: nul(q.satellite), instrument: nul(q.instrument),
            confidence: nul(q.confidence), product: nul(q.product) }, lang, props.current.timeZone, t);
          popup.remove();
          const [lon, lat] = f.geometry.coordinates as [number, number];
          const el = document.createElement("div");
          el.innerHTML = `<b>${esc(t.hsPopupTitle)}</b><br>${esc(d.when)}<br>${esc(t.hsSensor)}: ${esc(d.sensor)}<br>`
            + `${esc(t.hsConfidence)}: ${esc(d.confidence)}<br><span>NASA FIRMS · ${esc(d.product)}</span><br>`;
          const share = document.createElement("button");
          share.type = "button";
          share.className = "hs-share";
          share.textContent = t.vfShare;
          share.onclick = () => props.current.onShareHotspot({ lat, lon, date: q.date, at: nul(q.at) });
          el.appendChild(share);
          hotspotPopup.setLngLat([lon, lat]).setDOMContent(el).addTo(m);
        };
        for (const id of ["hotspots", "hotspots-new"]) {
          m.on("click", id, showHotspot);
          m.on("mouseenter", id, (e) => { m.getCanvas().style.cursor = "pointer"; showHotspot(e); });
          m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
        }
        // after every move, compare the camera with the area's own framing:
        // covers mouse, wheel, keyboard, buttons and touch alike
        m.on("moveend", () => {
          const home = m.cameraForBounds(props.current.zoneBBox, { padding: 40 });
          if (!home?.center || home.zoom === undefined) return;
          const a = m.project(m.getCenter()), b = m.project(home.center as maplibregl.LngLatLike);
          const moved = Math.hypot(a.x - b.x, a.y - b.y) > 12 || Math.abs(m.getZoom() - home.zoom) > 0.08
            || Math.abs(m.getBearing()) > 0.5 || m.getPitch() > 0.5;
          if (moved) props.current.onUserMove(); else props.current.onViewReset();
        });
        m.on("click", (e) => {
          if (!props.current.drawing) return;
          const next = [...draftRef.current, [e.lngLat.lng, e.lngLat.lat]];
          draftRef.current = next;
          setDraft(next);
        });
        m.on("dblclick", (e) => {
          if (!props.current.drawing) return;
          e.preventDefault();
          finish();
        });
        setReady(true);
      });
      map.current = m;
    })();
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, [mapAttempt]);

  const resetView = () => {
    const m = map.current;
    if (!m) return;
    m.fitBounds(props.current.zoneBBox, { padding: 40, bearing: 0, pitch: 0, duration: 600 });
  };
  const undo = () => {
    draftRef.current = draftRef.current.slice(0, -1);
    setDraft(draftRef.current);
  };
  const cancel = () => {
    draftRef.current = [];
    setDraft([]);
    props.current.onCancelDraw();
  };

  const finish = () => {
    // a double click also fires two clicks: drop consecutive duplicate points
    const pts = draftRef.current.filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-4);
    draftRef.current = [];
    setDraft([]);
    if (pts.length >= 3) props.current.onDrawn([...pts, pts[0]]);
    else props.current.onCancelDraw();
  };

  // drawing mode: cursor, no double-click zoom, Esc to cancel
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (p.drawing) { m.doubleClickZoom.disable(); m.getCanvas().style.cursor = "crosshair"; }
    else { m.doubleClickZoom.enable(); m.getCanvas().style.cursor = ""; draftRef.current = []; setDraft([]); }
    const onKey = (ev: KeyboardEvent) => {
      if (!props.current.drawing) return;
      if (ev.key === "Escape") cancel();
      if ((ev.key === "z" && (ev.ctrlKey || ev.metaKey)) || ev.key === "Backspace") { ev.preventDefault(); undo(); }
      if (ev.key === "Enter") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.drawing, ready]);

  // colour ramp follows the measure
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setPaintProperty("cells", "fill-color", rampExpr(p.metric === "frp" ? FRP_RAMP : CELL_RAMP));
  }, [ready, p.metric]);

  // grid cells for the selected month
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const features: GeoJSON.Feature[] = [];
    for (const idx of p.grid.cells.keys()) {
      features.push({ type: "Feature", properties: { id: idx, v: p.values.get(idx) ?? 0, sel: p.zone.has(idx) ? 1 : 0 },
                      geometry: { type: "Polygon", coordinates: [cellPolygon(p.grid.meta, idx)] } });
    }
    (m.getSource("cells") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [ready, p.values, p.zone, p.grid]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("hotspots") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p.hotspots.filter((h) => !p.newOnly || h.fresh)
        .map((h) => ({ type: "Feature", properties: { fresh: h.fresh ? 1 : 0, date: h.date, at: h.at ?? "", satellite: h.satellite ?? "",
          instrument: h.instrument ?? "", confidence: h.confidence ?? "", product: h.product ?? "" },
          geometry: { type: "Point", coordinates: [h.lon, h.lat] } })),
    });
  }, [ready, p.hotspots, p.newOnly]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("zone") as maplibregl.GeoJSONSource).setData(p.outline
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: p.outline }] }
      : empty);
  }, [ready, p.outline]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.fitBounds(p.zoneBBox, { padding: 40, bearing: 0, pitch: 0, duration: 600 });
  }, [ready, p.zoneBBox, p.viewNonce]);

  // after the zone framing, so a shared hotspot wins on the first load
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const f = p.focus;
    (m.getSource("focus") as maplibregl.GeoJSONSource).setData(f
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [f.lon, f.lat] } }] }
      : empty);
    if (f) m.flyTo({ center: [f.lon, f.lat], zoom: Math.max(m.getZoom(), 10), duration: 800 });
  }, [ready, p.focus]);

  // keep the home button tooltip in the current language
  useEffect(() => {
    if (homeBtn.current) homeBtn.current.title = homeBtn.current.ariaLabel = p.i18n.t.resetView;
  }, [p.i18n, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const f: GeoJSON.Feature[] = draft.map((q) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: q } }));
    if (draft.length > 1) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: draft } });
    (m.getSource("draft") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: f });
  }, [ready, draft]);

  return (
    <div className="map-wrap">
      <div ref={box} className="map" />
      {baseUnavailable && <div className="map-warning" role="status">{t.mapBaseUnavailable} <button type="button" onClick={() => { setReady(false); setMapAttempt(n => n + 1); }}>{t.mapRetry}</button></div>}
      {p.drawing && (
        <div className="draw-hint" role="status">
          <span>{t.drawHint}</span>
          <button className="ghost" onClick={undo} disabled={!draft.length}>{t.undoPoint}</button>
          <button className="ghost" onClick={cancel}>{t.cancel}</button>
          <button onClick={finish} disabled={draft.length < 3}>{t.finish(draft.length)}</button>
        </div>
      )}
      <div className="map-legend">
        <div className="legend-title">{t.mapLegend(p.monthLabel, cellKm)}</div>
        <div className="legend-ramp">
          {(p.metric === "frp" ? FRP_RAMP : CELL_RAMP).map(([v, c], i, a) => (<span key={v}><i style={{ background: c }} />{rampLabel(v, i === a.length - 1)}</span>))}
        </div>
        {p.hotspots.length > 0 && !p.newOnly && <div className="legend-dots"><i /> {p.pointsPeriod
          ? t.legendDotsIn(num(p.hotspots.length), p.pointsPeriod) : t.legendDots(num(p.hotspots.length))}</div>}
        {p.hotspots.length > 0 && p.showNew && <div className="legend-dots new"><i /> {t.legendNew(num(nNew))}</div>}
      </div>
    </div>
  );
}

