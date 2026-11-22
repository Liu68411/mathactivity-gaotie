import assert from 'node:assert/strict';
import {
  DEFAULTS,
  PRESETS,
  computeEstimate,
  estimateRange,
  solveLimitedSpeed,
  formatClock,
} from '../assets/model.js';

const simple = computeEstimate(DEFAULTS);
assert.equal(simple.valid, true);
assert.equal(formatClock(simple.arrival, true), '16:03:40');
assert.equal(formatClock(simple.arrivalRounded), '16:04');
assert.equal(simple.delayRounded, 38);
assert.equal(simple.departure, 13 * 60 + 45);
assert.equal(simple.slowStart, 14 * 60 + 45);
assert.ok(Math.abs(simple.runningMinutes - (60 + 236 / 3)) < 1e-9);

const segKm = simple.segments.reduce((sum, segment) => sum + segment.km, 0);
assert.ok(Math.abs(segKm - 536) < 1e-9, `segment km sum ${segKm}`);
const segMin = simple.segments.reduce((sum, segment) => sum + segment.minutes, 0);
assert.ok(Math.abs(segMin - simple.totalFromActual) < 1e-9);

const stops = computeEstimate({ ...DEFAULTS, ...PRESETS.withStops });
assert.equal(stops.valid, true);
assert.equal(formatClock(stops.arrival, true), '16:08:20');
assert.equal(formatClock(stops.arrivalRounded), '16:09');
assert.equal(stops.delayRounded, 43);
const stopsKm = stops.segments.reduce((sum, segment) => sum + segment.km, 0);
assert.ok(Math.abs(stopsKm - 536) < 1e-9, `stops km sum ${stopsKm}`);

const noDwell = computeEstimate({ ...DEFAULTS, dwell: 0 });
assert.equal(formatClock(noDwell.arrivalRounded), '16:01');
assert.equal(noDwell.delayRounded, 35);

const fixed = computeEstimate({ ...DEFAULTS, v2: 161 });
assert.equal(formatClock(fixed.arrivalRounded), '16:13');
assert.equal(fixed.arrivalRounded, 16 * 60 + 13);

const solvedSimple = solveLimitedSpeed(16 * 60 + 13, DEFAULTS);
assert.ok(Math.abs(solvedSimple - 160.9090909) < 0.001, `solved simple ${solvedSimple}`);
const solvedStops = solveLimitedSpeed(16 * 60 + 13, { ...DEFAULTS, ...PRESETS.withStops });
assert.ok(Math.abs(solvedStops - 170.117647) < 0.001, `solved stops ${solvedStops}`);

const range = estimateRange(DEFAULTS);
assert.equal(formatClock(range.min), '15:57');
assert.equal(formatClock(range.max), '16:11');

const invalid = computeEstimate({
  ...DEFAULTS,
  distance: 400,
  preSlow: 90,
  v1: 320,
  accel: 10,
  decel: 5,
  brake: 5,
});
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.length > 0);

console.log('model tests passed');
