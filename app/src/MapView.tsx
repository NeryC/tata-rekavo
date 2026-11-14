import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Grid } from "@core";
import { cellPolygon, type Hotspot } from "./data";
import type { I18n } from "./i18n";

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

interface Props {
  grid: Grid;
  monthLabel: string;
  values: Map<number, number>;
  zone: Set<number>;
  zoneBBox: [number, number, number, number];
  polygon: number[][] | null;
  hotspots: Hotspot[];
  newOnly: boolean;
  i18n: I18n;
  drawing: boolean;
  onDrawn: (ring: number[][]) => void;
  onCancelDraw: () => void;
}

type GJ = GeoJSON.FeatureCollection;
const empty: GJ = { type: "FeatureCollection", features: [] };

export default function MapView(p: Props) {
  const { t, num } = p.i18n;
  const nNew = p.hotspots.filter((h) => h.fresh).length;
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
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
      const m = new maplibregl.Map({
        container: box.current, style, bounds: [-62.8, -27.7, -54.1, -19.1],
        fitBoundsOptions: { padding: 24 }, attributionControl: { compact: true },
      });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => {
        m.addSource("cells", { type: "geojson", data: empty });
        m.addSource("zone", { type: "geojson", data: empty });
        m.addSource("draft", { type: "geojson", data: empty });
        m.addSource("hotspots", { type: "geojson", data: empty });
        const ramp: unknown[] = ["interpolate", ["linear"], ["get", "v"]];
        CELL_RAMP.forEach(([v, c]) => ramp.push(v, c));
        m.addLayer({
          id: "cells", type: "fill", source: "cells",
          paint: {
            "fill-color": ramp as maplibregl.ExpressionSpecification,
            "fill-opacity": ["case", ["<=", ["get", "v"], 0], 0, ["==", ["get", "sel"], 1], 0.85, 0.22],
          },
        });
        m.addLayer({ id: "hotspots", type: "circle", source: "hotspots", filter: ["==", ["get", "fresh"], 0],
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 9, 3], "circle-color": "#3d0c02",
                   "circle-opacity": 0.75 } });
        // hotspots in places with no fire on record within ~1 km: drawn on top, larger, in a contrasting hue
        m.addLayer({ id: "hotspots-new", type: "circle", source: "hotspots", filter: ["==", ["get", "fresh"], 1],
          paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.2, 9, 6], "circle-color": "#2a78d6",
                   "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 } });
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
          m.getCanvas().style.cursor = "default";
          popup.setLngLat(e.lngLat)
            .setHTML(`<b>${props.current.i18n.num(Number(f.properties.v))}</b> ${props.current.i18n.t.hotspots}<br><span>${props.current.i18n.t.popupCell(props.current.monthLabel)}</span>`)
            .addTo(m);
        });
        m.on("mouseleave", "cells", () => popup.remove());
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
  }, []);

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
      if (ev.key === "Escape") { draftRef.current = []; setDraft([]); props.current.onCancelDraw(); }
      if (ev.key === "Enter") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.drawing, ready]);

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
        .map((h) => ({ type: "Feature", properties: { fresh: h.fresh ? 1 : 0 }, geometry: { type: "Point", coordinates: [h.lon, h.lat] } })),
    });
  }, [ready, p.hotspots, p.newOnly]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("zone") as maplibregl.GeoJSONSource).setData(p.polygon
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: p.polygon } }] }
      : empty);
  }, [ready, p.polygon]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.fitBounds(p.zoneBBox, { padding: 40, duration: 600 });
  }, [ready, p.zoneBBox]);

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
      {p.drawing && (
        <div className="draw-hint" role="status">
          {t.drawHint}
          <button onClick={finish} disabled={draft.length < 3}>{t.finish(draft.length)}</button>
        </div>
      )}
      <div className="map-legend">
        <div className="legend-title">{t.mapLegend(p.monthLabel)}</div>
        <div className="legend-ramp">
          {CELL_RAMP.map(([v, c]) => (<span key={v}><i style={{ background: c }} />{v >= 1000 ? "1k+" : v}</span>))}
        </div>
        {p.hotspots.length > 0 && !p.newOnly && <div className="legend-dots"><i /> {t.legendDots(num(p.hotspots.length))}</div>}
        {p.hotspots.length > 0 && <div className="legend-dots new"><i /> {t.legendNew(num(nNew))}</div>}
      </div>
    </div>
  );
}
