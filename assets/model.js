/**
 * 专题三 · 雾雪限速后 G80 次会几点到站
 * 纯计算模型：不依赖 DOM，便于单元测试。
 *
 * 物理量的单位统一为：
 *   路程 s：千米（km）
 *   时间 t：小时（h）
 *   速度 v：千米/时（km/h）
 *
 * 速度均匀变化时，只用两个基础关系：
 *   v平均 = (v初 + v末) / 2
 *   v = s / t
 *
 * 速度变化用时按“0→350 km/h 用 0.25 h”的同一规律等比例换算。
 */

export const SPEED_REFERENCE = 350; // km/h
export const TIME_REFERENCE_HOURS = 0.25; // h（15 分钟）

export const DEFAULTS = Object.freeze({
  plannedWuhanArrival: 13 * 60 + 38, // 13:38，仅用于钟表时刻
  plannedWuhanDeparture: 13 * 60 + 41, // 13:41
  actualWuhanArrival: 13 * 60 + 42, // 13:42
  plannedZhengzhouArrival: 15 * 60 + 26, // 15:26
  actualZhengzhouArrival: 16 * 60 + 13, // 16:13（检验资料）
  distance: 536, // km
  dwellHours: 0.05, // 3 分钟 = 0.05 h
  preSlowHours: 1.0, // 出站后 1.00 h 开始减速
  v1: 300, // km/h
  v2: 180, // km/h
});

const EPS = 1e-9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundToMinuteUp(minutes) {
  return Math.ceil(minutes - EPS);
}

export function formatClock(minutes, withSeconds = false) {
  if (!Number.isFinite(minutes)) return '—';
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const hh = Math.floor(totalSeconds / 3600) % 24;
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const base = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return withSeconds ? `${base}:${String(ss).padStart(2, '0')}` : base;
}

export function formatHours(hours, digits = 3) {
  if (!Number.isFinite(hours)) return '—';
  return `${hours.toFixed(digits)} h`;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const total = Math.round(minutes);
  if (total < 60) return `${total} 分钟`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

export function formatKm(km) {
  if (!Number.isFinite(km)) return '—';
  return `${km.toFixed(1)} 千米`;
}

export function formatSpeed(speed) {
  if (!Number.isFinite(speed)) return '—';
  return `${Math.round(speed)} km/h`;
}

/**
 * 速度均匀变化时，速度变化量与时间成正比。
 * 用“0→350 km/h 用 0.25 h”作为标定，换算任意速度变化所需时间。
 */
export function timeForSpeedChange(fromSpeed, toSpeed) {
  return (Math.abs(toSpeed - fromSpeed) / SPEED_REFERENCE) * TIME_REFERENCE_HOURS;
}

/**
 * 核心估算。
 *
 * 运动过程：
 *   停站 → 匀加速到正常速度 → 匀速 → 匀减速到限速 → 限速匀速 → 匀减速进站
 * 每一段的速度变化都按同一规律用时，路程用平均速度乘时间。
 */
export function computeEstimate(input) {
  const s = { ...DEFAULTS, ...input };
  const errors = [];

  const distance = Number(s.distance);
  const dwellHours = Number(s.dwellHours);
  const preSlowHours = Number(s.preSlowHours);
  const v1 = Number(s.v1);
  const v2 = Number(s.v2);

  if (![distance, dwellHours, preSlowHours, v1, v2].every(Number.isFinite)) {
    errors.push('输入中有无法识别的数值。');
  }
  if (distance <= 0) errors.push('里程必须大于 0。');
  if (v1 <= 0 || v2 <= 0) errors.push('速度必须大于 0。');
  if (v2 > v1 + EPS) errors.push('限速后的速度不能高于正常速度。');
  if (dwellHours < 0) errors.push('停站时间不能为负数。');
  if (preSlowHours <= 0) errors.push('“出站后多久开始减速”必须大于 0。');

  const departureMinutes = Number(s.actualWuhanArrival) + dwellHours * 60;
  const departureHours = departureMinutes / 60;
  const slowStartMinutes = departureMinutes + preSlowHours * 60;

  const accelHours = timeForSpeedChange(0, v1);
  const decelHours = timeForSpeedChange(v1, v2);
  const brakeHours = timeForSpeedChange(v2, 0);
  const cruiseHours = preSlowHours - accelHours;

  if (cruiseHours < -EPS) {
    errors.push(
      `0→${v1} km/h 需要 ${accelHours.toFixed(3)} h，已经超过“出站 ${preSlowHours.toFixed(
        2
      )} h 后开始减速”。`
    );
  }

  const accelDistance = ((0 + v1) / 2) * accelHours;
  const cruiseDistance = v1 * cruiseHours;
  const decelDistance = ((v1 + v2) / 2) * decelHours;
  const brakeDistance = ((v2 + 0) / 2) * brakeHours;
  const beforeSlowDistance = accelDistance + cruiseDistance + decelDistance;
  const plateauDistance = distance - beforeSlowDistance - brakeDistance;

  if (plateauDistance < -EPS) {
    errors.push(
      `按这些假设，还没进入限速段就已经走完 ${distance} km 了。请缩短“出站后多久开始减速”或降低正常速度。`
    );
  }

  const valid = errors.length === 0 && plateauDistance >= -EPS;
  const safeCruiseHours = Math.max(0, cruiseHours);
  const safePlateauDistance = Math.max(0, plateauDistance);
  const plateauHours = safePlateauDistance / v2;
  const slowEndMinutes = slowStartMinutes + decelHours * 60;
  const arrivalHours =
    departureHours + preSlowHours + decelHours + plateauHours + brakeHours;
  const arrivalMinutes = arrivalHours * 60;
  const runningHours = arrivalHours - departureHours;
  const totalFromActualHours = arrivalHours - Number(s.actualWuhanArrival) / 60;
  const delay = arrivalMinutes - Number(s.plannedZhengzhouArrival);
  const averageSpeed = runningHours > 0 ? distance / runningHours : NaN;

  const segments = [
    {
      key: 'dwell',
      label: '武汉站停站',
      detail: '乘客上下车',
      hours: dwellHours,
      km: 0,
      speed: 0,
      tone: 'stop',
    },
    {
      key: 'accel',
      label: '匀加速启动',
      detail: `0 → ${Math.round(v1)} km/h`,
      hours: accelHours,
      km: accelDistance,
      speed: v1 / 2,
      tone: 'accel',
    },
  ];

  if (safeCruiseHours > EPS) {
    segments.push({
      key: 'cruise',
      label: `${Math.round(v1)} km/h 匀速`,
      detail: '减速前的正常运营',
      hours: safeCruiseHours,
      km: cruiseDistance,
      speed: v1,
      tone: 'cruise',
    });
  }

  if (decelHours > EPS) {
    segments.push({
      key: 'decel',
      label: '匀减速至限速',
      detail: `${Math.round(v1)} → ${Math.round(v2)} km/h`,
      hours: decelHours,
      km: decelDistance,
      speed: (v1 + v2) / 2,
      tone: 'decel',
    });
  }

  segments.push({
    key: 'plateau',
    label: `${Math.round(v2)} km/h 限速运行`,
    detail: '车厢显示屏一度显示的速度',
    hours: plateauHours,
    km: safePlateauDistance,
    speed: v2,
    tone: 'plateau',
  });

  segments.push({
    key: 'brake',
    label: '匀减速进站',
    detail: `${Math.round(v2)} → 0 km/h`,
    hours: brakeHours,
    km: brakeDistance,
    speed: v2 / 2,
    tone: 'brake',
  });

  const arrivalRounded = roundToMinuteUp(arrivalMinutes);
  const delayRounded = arrivalRounded - Number(s.plannedZhengzhouArrival);

  return {
    input: s,
    valid,
    errors,
    distance,
    departure: departureMinutes,
    departureHours,
    slowStart: slowStartMinutes,
    slowStartHours: slowStartMinutes / 60,
    slowEnd: slowEndMinutes,
    slowEndHours: slowEndMinutes / 60,
    arrival: arrivalMinutes,
    arrivalHours,
    arrivalRounded,
    delay,
    delayRounded,
    totalFromActual: totalFromActualHours * 60,
    totalFromActualHours,
    runningHours,
    averageSpeed,
    segments,
    accelHours,
    decelHours,
    brakeHours,
    cruiseHours: safeCruiseHours,
    plateauHours,
    accelMinutes: accelHours * 60,
    decelMinutes: decelHours * 60,
    brakeMinutes: brakeHours * 60,
    cruiseMinutes: safeCruiseHours * 60,
    plateauMinutes: plateauHours * 60,
    accelDistance,
    cruiseDistance,
    decelDistance,
    brakeDistance,
    beforeSlowDistance,
    plateauDistance: safePlateauDistance,
    dwellHours,
  };
}

/**
 * 生成 s-t 图（累计路程—时间）的采样点。
 * 停站在 s=0 处水平；变速段用平均速度逐段累加路程。
 */
export function buildDistanceTimeSeries(input) {
  const result = computeEstimate(input);
  if (!result.valid) return null;

  const points = [];
  const push = (t, s) => {
    if (points.length && Math.abs(points[points.length - 1].t - t) < 1e-9) {
      points[points.length - 1].s = s;
    } else {
      points.push({ t, s });
    }
  };

  const v1 = Number(result.input.v1);
  const v2 = Number(result.input.v2);
  const samples = 24;

  // 武汉站停站：从实际到达开始，s 保持为 0。
  push(Number(result.input.actualWuhanArrival), 0);
  push(result.departure, 0);

  // 匀加速：按比例取速度，再用平均速度累加路程。
  for (let i = 1; i <= samples; i += 1) {
    const fraction = i / samples;
    const speed = v1 * fraction;
    const tauHours = result.accelHours * fraction;
    push(result.departure + tauHours * 60, ((0 + speed) / 2) * tauHours);
  }

  // 匀速到开始减速。
  const sAccelEnd = result.accelDistance;
  const sCruiseEnd = sAccelEnd + result.cruiseDistance;
  if (result.cruiseHours > 0) {
    push(result.slowStart, sCruiseEnd);
  }

  // 匀减速到限速速度。
  for (let i = 1; i <= samples; i += 1) {
    const fraction = i / samples;
    const speed = v1 - (v1 - v2) * fraction;
    const tauHours = result.decelHours * fraction;
    push(result.slowStart + tauHours * 60, sCruiseEnd + ((v1 + speed) / 2) * tauHours);
  }
  const sSlowEnd = sCruiseEnd + result.decelDistance;

  // 限速段匀速。
  const brakeStart = result.arrival - result.brakeMinutes;
  push(brakeStart, sSlowEnd + result.plateauDistance);

  // 匀减速进站。
  const sBrakeStart = sSlowEnd + result.plateauDistance;
  for (let i = 1; i <= samples; i += 1) {
    const fraction = i / samples;
    const speed = v2 * (1 - fraction);
    const tauHours = result.brakeHours * fraction;
    push(result.arrival - result.brakeMinutes + tauHours * 60, sBrakeStart + ((v2 + speed) / 2) * tauHours);
  }

  return {
    result,
    points,
  };
}

/**
 * 让“1 小时”在 0.833—1.167 h 之间摆动，看看估计值有多敏感。
 * 这不是置信区间，只是单变量敏感性检查。
 */
export function estimateRange(input, spread = 1 / 6) {
  const base = { ...DEFAULTS, ...input };
  const lo = clamp(base.preSlowHours - spread, 0.5, 1.5);
  const hi = clamp(base.preSlowHours + spread, 0.5, 1.5);
  const lowResult = computeEstimate({ ...base, preSlowHours: lo });
  const highResult = computeEstimate({ ...base, preSlowHours: hi });
  if (!lowResult.valid || !highResult.valid) return null;
  const first = lowResult.arrivalRounded;
  const second = highResult.arrivalRounded;
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
    lowInput: lo,
    highInput: hi,
  };
}

/**
 * 按当前模型反推：要让列车恰好在 targetArrival 到站，限速后平均速度应是多少。
 * 用二分法，因为减速时间和制动距离也会随速度变化。
 */
export function solveLimitedSpeed(targetArrival, input) {
  const base = { ...DEFAULTS, ...input };
  const reaches = (v2) => {
    const result = computeEstimate({ ...base, v2 });
    return result.valid ? result.arrival : NaN;
  };

  let lo = 30;
  let hi = base.v1;
  const atLo = reaches(lo);
  const atHi = reaches(hi);
  if (!Number.isFinite(atLo) || !Number.isFinite(atHi)) return null;
  if (targetArrival < atHi || targetArrival > atLo) return null;

  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const arrival = reaches(mid);
    if (!Number.isFinite(arrival)) return null;
    if (arrival > targetArrival) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}
