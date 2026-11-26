import assert from "node:assert/strict";
import test from "node:test";
import {
  clampView,
  clipBounds,
  editClip,
  estimateLineMs,
  fitZoom,
  MAX_ZOOM,
  placeClip,
  rulerLabel,
  rulerStep,
  snapTo,
  zoomAround,
} from "../src/renderer/timelineMath";

const ids = ["l1", "l2", "l3", "l4"];

test("a line's gap is bounded by its nearest placed neighbours", () => {
  const marks = {
    l1: { startMs: 1000, endMs: 2500 },
    l2: { startMs: null, endMs: null },
    l3: { startMs: null, endMs: null },
    l4: { startMs: 9000, endMs: null },
  };
  assert.deepEqual(clipBounds(ids, marks, "l2", 20_000), { lower: 2500, upper: 9000 });
  assert.deepEqual(clipBounds(ids, marks, "l3", 20_000), { lower: 2500, upper: 9000 }, "unplaced l2 is skipped");
  assert.deepEqual(clipBounds(ids, marks, "l1", 20_000), { lower: 0, upper: 9000 });
  assert.deepEqual(clipBounds(ids, marks, "l4", 20_000), { lower: 2500, upper: 20_000 });
  // An automatic previous end ends where this line starts: only its start (+ min) bounds us.
  const derived = { ...marks, l1: { startMs: 1000, endMs: null } };
  assert.deepEqual(clipBounds(ids, derived, "l2", 20_000, 80), { lower: 1080, upper: 9000 });
});

test("dropping places the clip at the pointer, pulled into its gap", () => {
  const bounds = { lower: 2500, upper: 9000 };
  assert.deepEqual(placeClip(bounds, 4000, 2000), { ok: true, startMs: 4000, endMs: 6000, clamped: false });
  // Before the previous line: pulled to the gap start.
  assert.deepEqual(placeClip(bounds, 500, 2000), { ok: true, startMs: 2500, endMs: 4500, clamped: true });
  // Near the next line: the clip is shortened instead of overlapping it.
  assert.deepEqual(placeClip(bounds, 8500, 2000), { ok: true, startMs: 8500, endMs: 9000, clamped: false });
  // Past the next line's start: pulled back so at least the minimum length fits.
  assert.deepEqual(placeClip(bounds, 12_000, 2000, 80), { ok: true, startMs: 8920, endMs: 9000, clamped: true });
  // No room at all.
  assert.equal(placeClip({ lower: 5000, upper: 5050 }, 5000, 2000, 80).ok, false);
});

test("trimming and moving the selected clip never crosses its neighbours", () => {
  const bounds = { lower: 2000, upper: 10_000 };
  const base = { origStart: 4000, origEnd: 6000, endDerived: false, bounds, minClipMs: 80 };
  assert.deepEqual(editClip({ ...base, mode: "start", ms: 1000 }, 30_000), { startMs: 2000, endMs: 6000, recordEnd: true });
  assert.deepEqual(editClip({ ...base, mode: "start", ms: 5990 }, 30_000), { startMs: 5920, endMs: 6000, recordEnd: true });
  assert.deepEqual(editClip({ ...base, mode: "end", ms: 12_000 }, 30_000), { startMs: 4000, endMs: 10_000, recordEnd: true });
  assert.deepEqual(editClip({ ...base, mode: "end", ms: 4010 }, 30_000), { startMs: 4000, endMs: 4080, recordEnd: true });
  // Moving keeps the length and stops at either wall.
  assert.deepEqual(editClip({ ...base, mode: "move", ms: 9000 }, 30_000), { startMs: 8000, endMs: 10_000, recordEnd: true });
  assert.deepEqual(editClip({ ...base, mode: "move", ms: 0 }, 30_000), { startMs: 2000, endMs: 4000, recordEnd: true });
  // An automatic end stays put (it follows the next line); the start slides.
  const derived = { ...base, endDerived: true, origEnd: 10_000 };
  assert.deepEqual(editClip({ ...derived, mode: "move", ms: 7000 }, 30_000), { startMs: 7000, endMs: 10_000, recordEnd: false });
  assert.deepEqual(editClip({ ...derived, mode: "start", ms: 3000 }, 30_000), { startMs: 3000, endMs: 10_000, recordEnd: false });
  // Trimming its end records it.
  assert.equal(editClip({ ...derived, mode: "end", ms: 8000 }, 30_000).recordEnd, true);
  // Legacy clip stuck in an impossible gap can still be dragged anywhere in the audio.
  const stuck = { ...base, bounds: { lower: 7000, upper: 7010 } };
  assert.deepEqual(editClip({ ...stuck, mode: "move", ms: 15_000 }, 30_000), { startMs: 15_000, endMs: 17_000, recordEnd: true });
});

test("snapping picks the nearest target inside the threshold", () => {
  assert.equal(snapTo(1004, [0, 1000, 1010], 8), 1000);
  assert.equal(snapTo(1006, [0, 1000, 1010], 8), 1010);
  assert.equal(snapTo(1500, [0, 1000, 2000], 8), null);
});

test("zoom never leaves [fit, max] and keeps the anchor time under the cursor", () => {
  const width = 1000;
  const duration = 180_000;
  const fit = fitZoom(width, duration);
  assert.ok(Math.abs(fit - width / 180) < 1e-9);
  assert.deepEqual(clampView({ startMs: -50, zoom: 0.01 }, width, duration), { startMs: 0, zoom: fit });
  const deep = clampView({ startMs: 179_999, zoom: 1e9 }, width, duration);
  assert.equal(deep.zoom, MAX_ZOOM);
  assert.equal(deep.startMs, duration - (width / MAX_ZOOM) * 1000, "the view stops at the end of the audio");
  // Anchor: the time under x=400 stays under x=400 across a 10× zoom.
  const view = { startMs: 60_000, zoom: 50 };
  const anchorMs = view.startMs + (400 / view.zoom) * 1000;
  const zoomed = zoomAround(view, 500, 400, width, duration);
  assert.ok(Math.abs(zoomed.startMs + (400 / zoomed.zoom) * 1000 - anchorMs) < 1e-6);
  // At max zoom one pixel is 0.25 ms — far below what the ear can place.
  assert.equal(1000 / MAX_ZOOM, 0.25);
});

test("the ruler adapts from minutes down to milliseconds", () => {
  assert.deepEqual(rulerStep(5), { step: 30, minor: 3 });
  assert.deepEqual(rulerStep(100), { step: 1, minor: 5 });
  assert.deepEqual(rulerStep(4000), { step: 0.05, minor: 5 });
  assert.equal(rulerLabel(75, 5), "1:15");
  assert.equal(rulerLabel(75.25, 0.1), "1:15.2");
  assert.equal(rulerLabel(75.255, 0.05), "1:15.25");
  assert.equal(rulerLabel(75.2555, 0.005), "1:15.256");
});

test("the dropped clip length follows the sentence length", () => {
  assert.equal(estimateLineMs("Hi"), 1200);
  assert.equal(estimateLineMs("Nice to meet you too, Amir."), 600 + 6 * 380);
  assert.equal(estimateLineMs(Array.from({ length: 40 }, () => "word").join(" ")), 7000);
});
