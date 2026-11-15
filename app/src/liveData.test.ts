import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFileUrl, storeBase, validManifest } from "./liveData.ts";

const MANIFEST = { generated: "2026-11-15T16:33:16Z", prefix: "daily/2026-11-15T16-33Z/", countries: { PRY: "PRY/", BOL: "BOL/" } };

test("validManifest accepts the published shape", () => {
  assert.deepEqual(validManifest(MANIFEST), MANIFEST);
});

test("validManifest rejects broken manifests", () => {
  assert.equal(validManifest(null), null);
  assert.equal(validManifest("x"), null);
  assert.equal(validManifest({ ...MANIFEST, generated: 1 }), null);
  assert.equal(validManifest({ ...MANIFEST, prefix: "../secret/" }), null);
  assert.equal(validManifest({ ...MANIFEST, prefix: "daily/x" }), null);
  assert.equal(validManifest({ ...MANIFEST, countries: null }), null);
});

test("validManifest drops malformed country entries", () => {
  const m = validManifest({ ...MANIFEST, countries: { PRY: "PRY/", bol: "BOL/", URY: "../", ECU: 3 } });
  assert.deepEqual(m?.countries, { PRY: "PRY/" });
});

test("storeBase needs an https URL and ends it in a slash", () => {
  assert.equal(storeBase({ base: "https://pub-abc.r2.dev" }), "https://pub-abc.r2.dev/");
  assert.equal(storeBase({ base: "https://data.example.org/live/" }), "https://data.example.org/live/");
  assert.equal(storeBase({ base: null }), null);
  assert.equal(storeBase({ base: "http://pub-abc.r2.dev" }), null);
  assert.equal(storeBase({}), null);
  assert.equal(storeBase(null), null);
});

test("liveFileUrl builds the dated path, null for a country not in the run", () => {
  assert.equal(liveFileUrl("https://s/", MANIFEST, "BOL", "current.json"), "https://s/daily/2026-11-15T16-33Z/BOL/current.json");
  assert.equal(liveFileUrl("https://s/", MANIFEST, "PER", "current.json"), null);
});
