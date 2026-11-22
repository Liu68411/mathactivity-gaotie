import assert from 'node:assert/strict';
import {
  ACCEL_REFERENCE_SPEED,
  ACCEL_REFERENCE_MINUTES,
  UNIFORM_ACCELERATION,
  DEFAULTS,
  computeEstimate,
  buildDistanceTimeSeries,
  estimateRange,
  solveLimitedSpeed,
  formatClock,
} from '../assets/model.js';

assert.equal(ACCEL_REFERENCE_SPEED, 350);
assert.equal(ACCEL_REFERENCE_MINUTES, 15);
assert.ok(Math.abs(UNIFORM_ACCELERATION - 350 / 15) < 1e-12);

const simple = computeEstimate(DEFAULTS);
assert.equal(simple.valid, true);
assert.equal(formatClock(simple.arrival, true), '16:16:31');
assert.equal(formatClock(simple.arrivalRounded), '16:17');
assert.equal(simple.delayRounded, 51);
assert.equal(simple.departure, 13 * 60 + 45);
assert.equal(simple.slowStart, 14 * 60 + 45);
assert.ok(Math.abs(simple.accelMinutes - 300 / (350 / 15)) < 1e-9);
assert.ok(Math.abs(simple.decelMinutes - 120 / (350 / 15)) < 1e-9);
assert.ok(Math.abs(simple.brakeMinutes - 180 / (350 / 15)) < 1e-9);
assert.equal(simple.segments.length, 6);

const segKm = simple.segments.reduce((sum, segment) => sum + segment.km, 0);
assert.ok(Math.abs(segKm - 536) < 1e-9, `segment km sum ${segKm}`);
const segMin = simple.segments.reduce((sum, segment) => sum + segment.minutes, 0);
assert.ok(Math.abs(segMin - simple.totalFromActual) < 1e-9);

const fast = computeEstimate({ ...DEFAULTS, v1: 350 });
assert.equal(fast.valid, true);
assert.equal(fast.accelMinutes, 15);
assert.equal(formatClock(fast.arrivalRounded), '16:02');

const fixed = computeEstimate({ ...DEFAULTS, v2: 189 });
assert.equal(formatClock(fixed.arrivalRounded), '16:13');
assert.equal(fixed.delayRounded, 47);

const solved = solveLimitedSpeed(16 * 60 + 13, DEFAULTS);
assert.ok(Math.abs(solved - 188.4410646) < 0.001, `solved ${solved}`);

const series = buildDistanceTimeSeries(DEFAULTS);
assert.equal(series.points[0].t, DEFAULTS.actualWuhanArrival);
assert.equal(series.points[0].s, 0);
assert.ok(Math.abs(series.points.at(-1).t - simple.arrival) < 1e-9);
assert.equal(series.points.at(-1).s, 536);
assert.ok(series.points.length > 50);
assert.ok(series.points.every((point, index) => index === 0 || point.s >= series.points[index - 1].s - 1e-9));

const range = estimateRange(DEFAULTS);
assert.equal(formatClock(range.min), '16:10');
assert.equal(formatClock(range.max), '16:24');

const invalid = computeEstimate({ ...DEFAULTS, distance: 200 });
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.length > 0);

console.log('model tests passed');
