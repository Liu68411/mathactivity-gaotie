/**
 * 专题三 · 雾雪限速后 G80 次会几点到站
 * 纯计算模型：不依赖 DOM，便于单元测试。
 *
 * 时间统一用“当天 0 点起的分钟数”表示，速度单位 km/h，里程单位 km。
 */

export const DEFAULTS = Object.freeze({
  plannedWuhanArrival: 13 * 60 + 38, // 13:38
  plannedWuhanDeparture: 13 * 60 + 41, // 13:41
  actualWuhanArrival: 13 * 60 + 42, // 13:42
  plannedZhengzhouArrival: 15 * 60 + 26, // 15:26
  actualZhengzhouArrival: 16 * 60 + 13, // 16:13（检验资料）
  distance: 536,
  dwell: 3,
  preSlow: 60,
  v1: 300,
  v2: 180,
  accel: 0,
  decel: 0,
  brake: 0,
});

export const PRESETS = Object.freeze({
  simple: { accel: 0, decel: 0, brake: 0 },
  withStops: { accel: 5, decel: 3, brake: 3 },
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
  return `${Math.round(speed)} 千米/时`;
}

/**
 * 核心估算。
 *
 * 速度—时间曲线被切成：
 *   停站 → 启动加速 → 正常速度匀速 → 减速至限速 → 限速匀速 → 进站制动
 *
 * 加速、减速、制动默认都是 0 分钟，此时退化为最简单的“两段匀速”模型。
 */
export function computeEstimate(input) {
  const s = { ...DEFAULTS, ...input };
  const errors = [];

  const distance = Number(s.distance);
  const dwell = Number(s.dwell);
  const preSlow = Number(s.preSlow);
  const v1 = Number(s.v1);
  const v2 = Number(s.v2);
  const accel = Number(s.accel);
  const decel = Number(s.decel);
  const brake = Number(s.brake);

  if (![distance, dwell, preSlow, v1, v2, accel, decel, brake].every(Number.isFinite)) {
    errors.push('输入中有无法识别的数值。');
  }
  if (distance <= 0) errors.push('里程必须大于 0。');
  if (v1 <= 0 || v2 <= 0) errors.push('速度必须大于 0。');
  if (v2 > v1 + EPS) errors.push('限速后的速度不能高于正常速度。');
  if (accel < 0 || decel < 0 || brake < 0) errors.push('加速、减速、制动用时不能为负数。');
  if (preSlow <= 0) errors.push('“约 1 小时后减速”的用时必须大于 0。');
  if (accel > preSlow + EPS) errors.push('启动加速用时不能超过减速前的运行时间。');

  const departure = Number(s.actualWuhanArrival) + dwell;
  const slowStart = departure + preSlow;
  const slowEnd = slowStart + decel;

  const accelDistance = (v1 * accel) / 120;
  const cruiseMinutes = preSlow - accel;
  const cruiseDistance = (v1 * cruiseMinutes) / 60;
  const decelDistance = ((v1 + v2) / 2) * (decel / 60);
  const brakeDistance = (v2 * brake) / 120;
  const beforeSlowDistance = accelDistance + cruiseDistance + decelDistance;
  const plateauDistance = distance - beforeSlowDistance - brakeDistance;

  if (plateauDistance < -EPS) {
    errors.push('按这些假设，还没进入限速段就已经走完 536 千米了。请缩短减速前用时或降低正常速度。');
  }

  const valid = errors.length === 0 && plateauDistance >= -EPS;
  const safePlateauDistance = Math.max(0, plateauDistance);
  const plateauMinutes = (safePlateauDistance / v2) * 60;
  const arrival = departure + preSlow + decel + plateauMinutes + brake;
  const runningMinutes = arrival - departure;
  const delay = arrival - Number(s.plannedZhengzhouArrival);
  const totalFromActual = arrival - Number(s.actualWuhanArrival);
  const averageSpeed = runningMinutes > 0 ? distance / (runningMinutes / 60) : NaN;

  const segments = [
    {
      key: 'dwell',
      label: '武汉站停站',
      detail: '乘客上下车',
      minutes: dwell,
      km: 0,
      speed: 0,
      tone: 'stop',
    },
  ];

  if (accel > EPS) {
    segments.push({
      key: 'accel',
      label: '启动加速',
      detail: `0 → ${Math.round(v1)} 千米/时`,
      minutes: accel,
      km: accelDistance,
      speed: v1 / 2,
      tone: 'accel',
    });
  }
  if (cruiseMinutes > EPS) {
    segments.push({
      key: 'cruise',
      label: `${Math.round(v1)} 千米/时 匀速`,
      detail: '减速前的正常运营',
      minutes: cruiseMinutes,
      km: cruiseDistance,
      speed: v1,
      tone: 'cruise',
    });
  }
  if (decel > EPS) {
    segments.push({
      key: 'decel',
      label: '减速至限速',
      detail: `${Math.round(v1)} → ${Math.round(v2)} 千米/时`,
      minutes: decel,
      km: decelDistance,
      speed: (v1 + v2) / 2,
      tone: 'decel',
    });
  }
  segments.push({
    key: 'plateau',
    label: `${Math.round(v2)} 千米/时 限速运行`,
    detail: '车厢显示屏一度显示的速度',
    minutes: plateauMinutes,
    km: safePlateauDistance,
    speed: v2,
    tone: 'plateau',
  });
  if (brake > EPS) {
    segments.push({
      key: 'brake',
      label: '进站制动',
      detail: `${Math.round(v2)} → 0 千米/时`,
      minutes: brake,
      km: brakeDistance,
      speed: v2 / 2,
      tone: 'brake',
    });
  }

  const arrivalRounded = roundToMinuteUp(arrival);
  const delayRounded = arrivalRounded - Number(s.plannedZhengzhouArrival);

  return {
    input: s,
    valid,
    errors,
    distance,
    departure,
    slowStart,
    slowEnd,
    arrival,
    arrivalRounded,
    delay,
    delayRounded,
    totalFromActual,
    runningMinutes,
    averageSpeed,
    segments,
    accelDistance,
    cruiseDistance,
    decelDistance,
    brakeDistance,
    beforeSlowDistance,
    plateauDistance: safePlateauDistance,
    plateauMinutes,
    dwell,
  };
}

/**
 * 让“约 1 小时”在 50—70 分钟之间摆动，看看估计值有多敏感。
 * 这不是置信区间，只是单变量敏感性检查。
 */
export function estimateRange(input, spread = 10) {
  const base = { ...DEFAULTS, ...input };
  const lo = clamp(base.preSlow - spread, 30, 90);
  const hi = clamp(base.preSlow + spread, 30, 90);
  const a = computeEstimate({ ...base, preSlow: lo });
  const b = computeEstimate({ ...base, preSlow: hi });
  if (!a.valid || !b.valid) return null;
  const first = a.arrivalRounded;
  const second = b.arrivalRounded;
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
    lowInput: lo,
    highInput: hi,
  };
}

/**
 * 按当前模型反推：要让列车恰好在 targetArrival 到站，限速后平均速度应是多少。
 * 用二分法，因为制动距离也会随速度变化。
 */
export function solveLimitedSpeed(targetArrival, input) {
  const base = { ...DEFAULTS, ...input };
  const reaches = (v2) => {
    const result = computeEstimate({ ...base, v2 });
    return result.valid ? result.arrival : NaN;
  };

  let lo = 30;
  let hi = 300;
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

/**
 * 简洁模型下的“后段等效速度”：
 * 假设减速前整整 1 小时都按正常速度跑，剩余里程在剩余时间里走完。
 */
export function effectiveRemainingSpeed(input, actualArrival) {
  const s = { ...DEFAULTS, ...input };
  const departure = s.actualWuhanArrival + s.dwell;
  const start = departure + s.preSlow;
  const remainingDistance = s.distance - (s.v1 * s.preSlow) / 60;
  const remainingMinutes = actualArrival - start;
  if (remainingDistance <= 0 || remainingMinutes <= 0) return null;
  return (remainingDistance / remainingMinutes) * 60;
}
