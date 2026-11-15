import { test } from "node:test";
import assert from "node:assert/strict";
import { isContextStale, validateContext, validateIndigenous } from "./contextCheck.ts";

const series = () => ({ m: [1, 5], n: [2, 3.5], frp: [10, 20.5] });
const good = () => ({
  meta: { source: "WDPA", citation: "UNEP-WCMC and IUCN (2026)", terms: "t", through: "2026-11", first: "2002-07", generated: "2026-11-15T05:16:48+00:00",
    unit: "u", overlap_note: "o", through_day: "2026-11-14", retrieved: "2026-11-14" },
  areas: [{ id: "1", name: "A", desig: "National Park", departments: ["d1"], regions: ["chaco"], ...series(), by_zone: { d1: series(), chaco: series() } }],
  zones: { paraguay: series(), chaco: series(), d1: series() },
});

test("validateContext accepts a well-formed file and returns it", () => {
  const j = good();
  assert.equal(validateContext(j), j);
});

test("validateContext rejects non-objects and wrong shapes", () => {
  for (const bad of [null, undefined, 3, "x", [], {}, { meta: {}, areas: [], zones: {} }]) assert.equal(validateContext(bad), null);
  const noAreas = good() as unknown as { areas: unknown }; noAreas.areas = {};
  assert.equal(validateContext(noAreas), null);
  const zonesArray = good() as unknown as { zones: unknown }; zonesArray.zones = [];
  assert.equal(validateContext(zonesArray), null);
});

test("validateContext rejects bad formats in meta", () => {
  for (const [k, v] of [["through", "2026-1"], ["through", 202611], ["first", "2002/07"], ["retrieved", "14 Nov 2026"], ["through_day", "2026-11"], ["citation", 5]] as const) {
    const j = good(); (j.meta as Record<string, unknown>)[k] = v;
    assert.equal(validateContext(j), null, `${k}=${String(v)}`);
  }
  const noRetrieved = good(); delete (noRetrieved.meta as Record<string, unknown>).retrieved;
  assert.equal(validateContext(noRetrieved), null);
  const noDay = good(); delete (noDay.meta as Record<string, unknown>).through_day; // optional
  assert.ok(validateContext(noDay));
});

test("validateContext rejects series with unequal lengths, non-numeric values or bad months", () => {
  const unequal = good(); unequal.areas[0].n = [1];
  assert.equal(validateContext(unequal), null);
  const strVal = good(); (strVal.areas[0].frp as unknown[])[0] = "10";
  assert.equal(validateContext(strVal), null);
  const nan = good(); nan.zones.paraguay.n = [1, Number.NaN];
  assert.equal(validateContext(nan), null);
  const badMonth = good(); badMonth.zones.chaco.m = [1.5, 2];
  assert.equal(validateContext(badMonth), null);
  const badZone = good(); (badZone.areas[0].by_zone as Record<string, unknown>).d1 = { m: [1], n: [1] };
  assert.equal(validateContext(badZone), null);
});

test("validateContext rejects an area without by_zone or with bad department lists", () => {
  const noBz = good(); delete (noBz.areas[0] as Record<string, unknown>).by_zone;
  assert.equal(validateContext(noBz), null);
  const deps = good(); (deps.areas[0].departments as unknown[]).push(7);
  assert.equal(validateContext(deps), null);
});

test("isContextStale: with through_day, only a hotspot dated after it makes the figures stale", () => {
  const c = validateContext(good())!;
  assert.equal(isContextStale(c, "2026-11-14", "2026-11-15T05:11:00+00:00"), false);
  assert.equal(isContextStale(c, "2026-11-13", null), false);
  assert.equal(isContextStale(c, "2026-11-15", null), true);
  assert.equal(isContextStale(c, null, null), false);
});

test("isContextStale: without through_day, a context generated before current.json is stale", () => {
  const j = good(); delete (j.meta as Record<string, unknown>).through_day;
  const c = validateContext(j)!;
  assert.equal(isContextStale(c, "2026-11-15", "2026-11-15T09:00:00+00:00"), true);
  assert.equal(isContextStale(c, "2026-11-15", "2026-11-15T05:00:00+00:00"), false);
  assert.equal(isContextStale(c, "2026-11-15", undefined), false);
});

const indigenous = () => {
  const j = good() as unknown as { meta: Record<string, unknown>; areas: Record<string, unknown>[] };
  Object.assign(j.meta, { source: "LandMark", license: "CC BY-SA 4.0", contributors: ["FAPI", "INDI"], by_zone_default: "whole", layer: "indigenous" });
  Object.assign(j.areas[0], { identity: "Indigenous", category: "Tierra Indígena", ethnicity: "Mbya, Guarani" });
  delete j.areas[0].desig;
  return j;
};

test("validateIndigenous accepts a territory file (license, contributors, optional text fields, whole default) and returns it", () => {
  const j = indigenous();
  assert.equal(validateIndigenous(j), j);
  delete j.areas[0].ethnicity;           // ethnicity is omitted when the source has none
  assert.ok(validateIndigenous(j));
  delete j.meta.by_zone_default;         // the default is optional
  assert.ok(validateIndigenous(j));
});

test("validateIndigenous needs the license and the contributors, and rejects what validateContext rejects", () => {
  for (const k of ["license", "contributors"]) { const j = indigenous(); delete j.meta[k]; assert.equal(validateIndigenous(j), null, k); }
  const bad = indigenous(); bad.meta.contributors = ["ok", 3]; assert.equal(validateIndigenous(bad), null);
  const dflt = indigenous(); dflt.meta.by_zone_default = "none"; assert.equal(validateIndigenous(dflt), null);
  const eth = indigenous(); eth.areas[0].ethnicity = 5; assert.equal(validateIndigenous(eth), null);
  const unequal = indigenous(); unequal.areas[0].n = [1]; assert.equal(validateIndigenous(unequal), null);
  assert.equal(validateIndigenous(null), null);
});

test("validateIndigenous rejects any file that carries geometry", () => {
  for (const key of ["geometry", "coordinates", "bbox", "centroid", "lat", "lon"]) {
    const a = indigenous(); a.areas[0][key] = [1, 2]; assert.equal(validateIndigenous(a), null, `area.${key}`);
    const m = indigenous(); m.meta[key] = 1; assert.equal(validateIndigenous(m), null, `meta.${key}`);
  }
  const top = indigenous() as unknown as Record<string, unknown>; top.geometry = {}; assert.equal(validateIndigenous(top), null);
});
