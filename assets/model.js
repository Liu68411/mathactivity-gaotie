/**
 * 专题三 · 雾雪限速后 G80 次会几点到站
 * 纯计算模型：不依赖 DOM，便于单元测试。
 *
 * 时间统一用“当天 0 点起的分钟数”表示，速度单位 km/h，里程单位 km。
 *
 * 运动模型：
 *   停站 → 匀加速到正常速度 → 匀速 → 匀减速到限速 → 限速匀速 → 匀减速进站
 * 所有加速、减速、制动都使用同一个加速度：
 *   15 分钟从 0 加速到 350 km/h
 *   a = 350 ÷ 15 ≈ 23.333 km/h/min
 */

export const ACCEL_REFERENCE_SPEED = 350; // km/h
export const ACCEL_REFERENCE_MINUTES = 15; // min
export const UNIFORM_ACCELERATION = ACCEL_REFERENCE_SPEED / ACCEL_REFERENCE_MINUTES; // km/h per min

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
 * 加速、减速、制动段都按匀变速处理，用平均速度乘时间求路程。
 */
export function computeEstimate(input) {
  const s = { ...DEFAULTS, ...input };
  const errors = [];

  const distance = Number(s.distance);
  const dwell = Number(s.dwell);
  const preSlow = Number(s.preSlow);
  const v1 = Number(s.v1);
  const v2 = Number(s.v2);
  const acceleration = UNIFORM_ACCELERATION;

  if (![distance, dwell, preSlow, v1, v2].every(Number.isFinite)) {
    errors.push('输入中有无法识别的数值。');
  }
  if (distance <= 0) errors.push('里程必须大于 0。');
  if (v1 <= 0 || v2 <= 0) errors.push('速度必须大于 0。');
  if (v2 > v1 + EPS) errors.push('限速后的速度不能高于正常速度。');
  if (preSlow <= 0) errors.push('“约 1 小时后减速”的用时必须大于 0。');

  const departure = Number(s.actualWuhanArrival) + dwell;
  const slowStart = departure + preSlow;

  const accelMinutes = v1 / acceleration;
  const decelMinutes = Math.max(0, (v1 - v2) / acceleration);
  const brakeMinutes = v2 / acceleration;
  const cruiseMinutes = preSlow - accelMinutes;

  const accelDistance = (v1 / 2) * (accelMinutes / 60);
  const cruiseDistance = (v1 * cruiseMinutes) / 60;
  const decelDistance = ((v1 + v2) / 2) * (decelMinutes / 60);
  const brakeDistance = (v2 / 2) * (brakeMinutes / 60);

  if (cruiseMinutes < -EPS) {
    errors.push(
      `按 0→${ACCEL_REFERENCE_SPEED} 千米/时用 ${ACCEL_REFERENCE_MINUTES} 分钟的加速度，加速到 ${Math.round(
        v1
      )} 千米/时就要 ${accelMinutes.toFixed(1)} 分钟，已经超过“出站 ${preSlow} 分钟后减速”。`
    );
  }

  const beforeSlowDistance = accelDistance + cruiseDistance + decelDistance;
  const plateauDistance = distance - beforeSlowDistance - brakeDistance;

  if (plateauDistance < -EPS) {
    errors.push(
      `按这些假设，还没进入限速段就已经走完 ${distance} 千米了。请缩短减速前用时或降低正常速度。`
    );
  }

  const valid = errors.length === 0 && plateauDistance >= -EPS;
  const safeCruiseMinutes = Math.max(0, cruiseMinutes);
  const safePlateauDistance = Math.max(0, plateauDistance);
  const plateauMinutes = (safePlateauDistance / v2) * 60;
  const slowEnd = slowStart + decelMinutes;
  const arrival = slowEnd + plateauMinutes + brakeMinutes;
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
    {
      key: 'accel',
      label: '匀加速启动',
      detail: `0 → ${Math.round(v1)} 千米/时，a ≈ ${acceleration.toFixed(1)} 千米/时/分`,
      minutes: accelMinutes,
      km: accelDistance,
      speed: v1 / 2,
      tone: 'accel',
    },
  ];

  if (safeCruiseMinutes > EPS) {
    segments.push({
      key: 'cruise',
      label: `${Math.round(v1)} 千米/时 匀速`,
      detail: '减速前的正常运营',
      minutes: safeCruiseMinutes,
      km: cruiseDistance,
      speed: v1,
      tone: 'cruise',
    });
  }

  if (decelMinutes > EPS) {
    segments.push({
      key: 'decel',
      label: '匀减速至限速',
      detail: `${Math.round(v1)} → ${Math.round(v2)} 千米/时`,
      minutes: decelMinutes,
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

  segments.push({
    key: 'brake',
    label: '匀减速进站',
    detail: `${Math.round(v2)} → 0 千米/时`,
    minutes: brakeMinutes,
    km: brakeDistance,
    speed: v2 / 2,
    tone: 'brake',
  });

  const arrivalRounded = roundToMinuteUp(arrival);
  const delayRounded = arrivalRounded - Number(s.plannedZhengzhouArrival);

  return {
    input: s,
    valid,
    errors,
    distance,
    acceleration,
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
    accelMinutes,
    decelMinutes,
    brakeMinutes,
    cruiseMinutes: safeCruiseMinutes,
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
 * 生成 s-t 图（累计路程—时间）的采样点。
 * 停站在 s=0 处水平；加速、减速、制动按匀变速曲线采样。
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

  const a = result.acceleration;
  const v1 = Number(result.input.v1);
  const v2 = Number(result.input.v2);
  const samples = 24;

  // 武汉站停站：从实际到达开始，s 保持为 0。
  push(Number(result.input.actualWuhanArrival), 0);
  push(result.departure, 0);

  // 匀加速：s = 1/2 a t²（t 以分钟计，再除以 60 换成小时）。
  for (let i = 1; i <= samples; i += 1) {
    const tau = (result.accelMinutes * i) / samples;
    push(result.departure + tau, (0.5 * a * tau * tau) / 60);
  }

  // 匀速到开始减速。
  const sAccelEnd = result.accelDistance;
  const sCruiseEnd = sAccelEnd + result.cruiseDistance;
  if (result.cruiseMinutes > 0) {
    push(result.slowStart, sCruiseEnd);
  }

  // 匀减速到限速速度。
  for (let i = 1; i <= samples; i += 1) {
    const tau = (result.decelMinutes * i) / samples;
    const s = sCruiseEnd + (v1 * tau) / 60 - (0.5 * a * tau * tau) / 60;
    push(result.slowStart + tau, s);
  }
  const sSlowEnd = sCruiseEnd + result.decelDistance;

  // 限速段匀速。
  const brakeStart = result.arrival - result.brakeMinutes;
  push(brakeStart, sSlowEnd + result.plateauDistance);

  // 匀减速进站。
  const sBrakeStart = sSlowEnd + result.plateauDistance;
  for (let i = 1; i <= samples; i += 1) {
    const tau = (result.brakeMinutes * i) / samples;
    const s = sBrakeStart + (v2 * tau) / 60 - (0.5 * a * tau * tau) / 60;
    push(result.arrival - result.brakeMinutes + tau, s);
  }

  return {
    result,
    points,
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
