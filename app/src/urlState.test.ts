import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeState, encodeState, validateCoords, type ShareState } from "./urlState.ts";

const ring = (n: number): number[][] =>
  Array.from({ length: n }, (_, i) => [
    Math.round((-57.123 + Math.sin(i) * 2) * 1000) / 1000,
    Math.round((-25.123 + Math.cos(i) * 2) * 1000) / 1000,
  ]);

test("encodeState({}) is empty", () => {
  assert.equal(encodeState({}), "");
});

test("default values are not written", () => {
  assert.equal(encodeState({ zone: "paraguay", cal: "ratio", naive: false, newOnly: false }), "");
});

test("lang is written only when present", () => {
  assert.equal(encodeState({ lang: "es" }), "lang=es");
  assert.equal(encodeState({ zone: "chaco" }), "z=chaco");
});

test("old links keep working: lang=es", () => {
  assert.deepEqual(decodeState("lang=es"), { lang: "es" });
  assert.deepEqual(decodeState("?lang=en"), { lang: "en" });
  assert.deepEqual(decodeState(""), {});
});

test("round-trip of a full state", () => {
  const s: ShareState = {
    lang: "es",
    zone: "custom",
    poly: [[-57.5, -25.25], [-57.1, -25.25], [-57.1, -25.75], [-57.5, -25.75]],
    c: { lat: -25.5, lon: -57.3, r: 25 },
    m: "2025-09",
    range: ["2025-07", "2025-10"],
    cal: "count",
    naive: true,
    newOnly: true,
    metric: "frp",
  };
  assert.deepEqual(decodeState(encodeState(s)), s);
});

test("round-trip with department", () => {
  const s: ShareState = { zone: "department", dep: "PY-11", m: "2024-08" };
  assert.deepEqual(decodeState(encodeState(s)), s);
});

test("decode accepts raw and percent-encoded separators", () => {
  const raw = decodeState("poly=-57.5,-25.2;-57.1,-25.2;-57.1,-25.7");
  const enc = decodeState("poly=-57.5%2C-25.2%3B-57.1%2C-25.2%3B-57.1%2C-25.7");
  assert.deepEqual(raw, { poly: [[-57.5, -25.2], [-57.1, -25.2], [-57.1, -25.7]] });
  assert.deepEqual(enc, raw);
});

test("number formatting: up to 3 decimals, trimmed", () => {
  const q = encodeState({ poly: [[-57.12345, -25.5], [-57, -25.1], [-57.1, -25.0004]] });
  assert.match(decodeURIComponent(q), /^poly=-57\.123,-25\.5;-57,-25\.1;-57\.1,-25$/);
});

test("invalid month is ignored but format-valid out-of-range is kept", () => {
  assert.deepEqual(decodeState("m=2026-13"), {});
  assert.deepEqual(decodeState("m=2026-00"), {});
  assert.deepEqual(decodeState("m=garbage"), {});
  assert.deepEqual(decodeState("m=2027-01"), { m: "2027-01" });
});

test("range requires two valid months", () => {
  assert.deepEqual(decodeState("r=2025-01..2025-06"), { range: ["2025-01", "2025-06"] });
  assert.deepEqual(decodeState("r=2025-01..2025-13"), {});
  assert.deepEqual(decodeState("r=2025-01"), {});
});

test("coords outside Paraguay are ignored", () => {
  assert.deepEqual(decodeState("c=-30,-60,25"), {});
  assert.deepEqual(decodeState("c=-25.5,-57.3,25"), { c: { lat: -25.5, lon: -57.3, r: 25 } });
  assert.deepEqual(decodeState("c=-25.5,-57.3,4"), {});
  assert.deepEqual(decodeState("c=-25.5,-57.3"), {});
  assert.deepEqual(decodeState("c=a,b,c"), {});
});

test("polygon with fewer than 3 vertices is ignored", () => {
  assert.deepEqual(decodeState("poly=-57.5,-25.2;-57.1,-25.2"), {});
  assert.deepEqual(decodeState("poly=-57.5,-25.2;-57.1,-25.2;x,y"), {});
  assert.deepEqual(decodeState("poly="), {});
});

test("unknown enum values are ignored", () => {
  assert.deepEqual(decodeState("lang=fr&z=mars&cal=weird"), {});
  assert.deepEqual(decodeState("z=chaco&cal=count&naive=1&new=1"), {
    zone: "chaco", cal: "count", naive: true, newOnly: true,
  });
  assert.deepEqual(decodeState("naive=0&new=true"), {});
});

test("zone paraguay and cal ratio decode but are not re-encoded", () => {
  assert.deepEqual(decodeState("z=paraguay&cal=ratio"), { zone: "paraguay", cal: "ratio" });
});

test("polygon over 120 vertices is decimated, URL under 2000 chars", () => {
  const poly = ring(300);
  const q = encodeState({ zone: "custom", poly });
  assert.ok(q.length < 2000, `query length ${q.length}`);
  const back = decodeState(q).poly!;
  assert.ok(back.length <= 120 && back.length >= 3);
  assert.deepEqual(back[0], poly[0]);
  // every decoded vertex comes from the original polygon, in order
  let from = 0;
  for (const v of back) {
    const i = poly.findIndex((p, k) => k >= from && p[0] === v[0] && p[1] === v[1]);
    assert.ok(i >= from, "vertex order preserved");
    from = i + 1;
  }
});

test("polygon of 120 vertices or fewer is untouched", () => {
  const poly = ring(120);
  assert.deepEqual(decodeState(encodeState({ poly })).poly, poly);
});

test("validateCoords bounds", () => {
  assert.equal(validateCoords(-25.3, -57.6, 25), true);
  assert.equal(validateCoords(-27.7, -62.8, 5), true);
  assert.equal(validateCoords(-19.1, -54.1, 300), true);
  assert.equal(validateCoords(-27.71, -57, 25), false);
  assert.equal(validateCoords(-19.0, -57, 25), false);
  assert.equal(validateCoords(-25, -62.9, 25), false);
  assert.equal(validateCoords(-25, -54.0, 25), false);
  assert.equal(validateCoords(-25, -57, 4.9), false);
  assert.equal(validateCoords(-25, -57, 301), false);
  assert.equal(validateCoords(NaN, -57, 25), false);
});

test("metric: frp is written as x=frp, the default count is never written", () => {
  assert.equal(encodeState({ metric: "frp" }), "x=frp");
  assert.equal(encodeState({ metric: "count" }), "");
  assert.equal(encodeState({ zone: "chaco", m: "2024-09", metric: "frp" }), "z=chaco&m=2024-09&x=frp");
});

test("metric: x=frp decodes, anything else is ignored (including an explicit count)", () => {
  assert.deepEqual(decodeState("x=frp"), { metric: "frp" });
  assert.deepEqual(decodeState("x=count"), {});
  assert.deepEqual(decodeState("x=FRP&z=chaco"), { zone: "chaco" });
  assert.deepEqual(decodeState("x="), {});
});

test("metric round-trips together with area and month", () => {
  const s: ShareState = { zone: "department", dep: "PY-11", m: "2024-09", metric: "frp" };
  assert.deepEqual(decodeState(encodeState(s)), s);
});
