import {
  DEFAULTS,
  PRESETS,
  computeEstimate,
  estimateRange,
  solveLimitedSpeed,
  formatClock,
  formatDuration,
  formatKm,
} from './model.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  ...DEFAULTS,
  actualRevealed: false,
};

const els = {};
let renderQueued = false;
let toastTimer = null;
let snowRaf = null;

function cacheElements() {
  els.resultTime = $('#resultTime');
  els.resultDelay = $('#resultDelay');
  els.resultSub = $('#resultSub');
  els.metaDeparture = $('#metaDeparture');
  els.metaSlow = $('#metaSlow');
  els.metaRuntime = $('#metaRuntime');
  els.metaAvg = $('#metaAvg');
  els.rangeNote = $('#rangeNote');

  els.bigArrival = $('#bigArrival');
  els.bigDelay = $('#bigDelay');
  els.answerSub = $('#answerSub');

  els.speedChart = $('#speedChart');
  els.chartCaption = $('#chartCaption');

  els.distanceBar = $('#distanceBar');
  els.distanceBeforeBar = $('#distanceBeforeBar');
  els.distanceAfterBar = $('#distanceAfterBar');
  els.distanceBeforeLabel = $('#distanceBeforeLabel');
  els.distanceAfterLabel = $('#distanceAfterLabel');
  els.distanceTag = $('#distanceTag');

  els.formulaList = $('#formulaList');
  els.formulaNote = $('#formulaNote');
  els.segmentTableBody = $('#segmentTableBody');
  els.segmentTableFoot = $('#segmentTableFoot');

  els.sealedCard = $('#sealedCard');
  els.actualPanel = $('#actualPanel');
  els.revealBtn = $('#revealBtn');
  els.resealBtn = $('#resealBtn');
  els.legendActual = $('#legendActual');
  els.cmpEstimate = $('#cmpEstimate');
  els.cmpEstimateDelay = $('#cmpEstimateDelay');
  els.cmpActual = $('#cmpActual');
  els.cmpError = $('#cmpError');
  els.cmpErrorCard = $('#cmpErrorCard');
  els.errorBanner = $('#errorBanner');
  els.compareChart = $('#compareChart');
  els.requiredSpeedText = $('#requiredSpeedText');
  els.solveBtn = $('#solveBtn');

  els.reportText = $('#reportText');
  els.promptArrival = $('#promptArrival');
  els.promptDelay = $('#promptDelay');
  els.promptThird = $('#promptThird');
  els.copyBtn = $('#copyBtn');
  els.toast = $('#toast');

  els.classInput = $('#classInput');
  els.groupInput = $('#groupInput');
  els.membersInput = $('#membersInput');
  els.recorderInput = $('#recorderInput');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getInput(key) {
  return $(`[data-bind="${key}"]`);
}

function setOutput(key, value) {
  const output = $(`#${key}Out`);
  if (!output) return;
  if (key === 'dwell' || key === 'preSlow' || key === 'accel' || key === 'decel' || key === 'brake') {
    output.textContent = `${value} 分钟`;
  } else if (key === 'v1' || key === 'v2') {
    output.textContent = `${value} 千米/时`;
  } else if (key === 'distance') {
    output.textContent = `${value} 千米`;
  }
}

function updateRangeFill(input) {
  if (!input) return;
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 50;
  input.style.setProperty('--fill', `${pct}%`);
}

function syncControls() {
  $$('[data-bind]').forEach((input) => {
    const key = input.dataset.bind;
    input.value = state[key];
    updateRangeFill(input);
    setOutput(key, state[key]);
  });
  markPreset();
}

function markPreset() {
  const isSimple = state.accel === 0 && state.decel === 0 && state.brake === 0;
  const isStops =
    state.accel === PRESETS.withStops.accel &&
    state.decel === PRESETS.withStops.decel &&
    state.brake === PRESETS.withStops.brake;

  $$('.preset').forEach((button) => {
    const preset = button.dataset.preset;
    button.classList.toggle(
      'is-active',
      (preset === 'simple' && isSimple) || (preset === 'withStops' && isStops)
    );
    button.setAttribute(
      'aria-pressed',
      ((preset === 'simple' && isSimple) || (preset === 'withStops' && isStops)) ? 'true' : 'false'
    );
  });
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

function renderAll() {
  const result = computeEstimate(state);
  const range = result.valid ? estimateRange(state) : null;

  renderResult(result, range);
  renderAnswer(result);
  renderSpeedChart(result);
  renderBreakdown(result);
  renderTable(result);
  renderPrintSummary(result);
  renderReport(result);

  if (state.actualRevealed) {
    renderComparison(result);
  }
}

function modelLabel() {
  if (state.accel === 0 && state.decel === 0 && state.brake === 0) return '简洁分段模型';
  if (
    state.accel === PRESETS.withStops.accel &&
    state.decel === PRESETS.withStops.decel &&
    state.brake === PRESETS.withStops.brake
  ) {
    return '计入启停模型';
  }
  return '自定义模型';
}

function delayText(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.round(minutes);
  if (rounded === 0) return '与计划持平';
  return rounded > 0 ? `比计划晚 ${rounded} 分钟` : `比计划早 ${Math.abs(rounded)} 分钟`;
}

function errorText(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.round(minutes);
  if (rounded === 0) return '刚好';
  return rounded < 0 ? `早 ${Math.abs(rounded)} 分钟` : `晚 ${rounded} 分钟`;
}

function renderResult(result, range) {
  if (!result.valid) {
    els.resultTime.textContent = '—';
    els.resultDelay.textContent = '当前假设不成立';
    els.resultSub.textContent = result.errors[0] || '请调整假设后重试。';
    [els.metaDeparture, els.metaSlow, els.metaRuntime, els.metaAvg].forEach((el) => {
      el.textContent = '—';
    });
    els.rangeNote.textContent = '先让各段路程加起来不超过 536 千米。';
    return;
  }

  els.resultTime.textContent = formatClock(result.arrivalRounded);
  els.resultDelay.textContent = delayText(result.delayRounded);
  els.resultSub.textContent = `按 ${formatClock(result.departure)} 发车、${formatClock(
    result.slowStart
  )} 开始减速计算。`;
  els.metaDeparture.textContent = formatClock(result.departure);
  els.metaSlow.textContent = formatClock(result.slowStart);
  els.metaRuntime.textContent = formatDuration(result.totalFromActual);
  els.metaAvg.textContent = `${Math.round(result.averageSpeed)} 千米/时`;

  if (range) {
    if (range.min === range.max) {
      els.rangeNote.textContent = `在 ${range.lowInput}–${range.highInput} 分钟的假设范围内，估计仍为 ${formatClock(
        range.min
      )}。`;
    } else {
      els.rangeNote.textContent = `若“1 小时”在 ${range.lowInput}–${range.highInput} 分钟之间摆动，估计落在 ${formatClock(
        range.min
      )}–${formatClock(range.max)}。`;
    }
  } else {
    els.rangeNote.textContent = '拖动“出站后多久开始减速”，看看估计对这条假设有多敏感。';
  }
}

function renderAnswer(result) {
  if (!result.valid) {
    els.bigArrival.textContent = '—';
    els.bigDelay.textContent = '—';
    els.answerSub.textContent = '当前假设走不完 536 千米，请先调整左侧参数。';
    return;
  }

  els.bigArrival.textContent = formatClock(result.arrivalRounded);
  els.bigDelay.textContent = String(Math.abs(result.delayRounded));
  const transition = state.accel || state.decel || state.brake
    ? '，并计入启动、降速和进站制动'
    : '';
  els.answerSub.textContent = `这是按停站 ${state.dwell} 分钟、出站 ${state.preSlow} 分钟后降到 ${state.v2} 千米/时${transition}得到的估计。`;
}

function svgText(x, y, text, className, extra = '') {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${className}" ${extra}>${text}</text>`;
}

function renderSpeedChart(result) {
  const svg = els.speedChart;
  if (!svg) return;

  if (!result.valid) {
    svg.innerHTML = `
      <rect x="0" y="0" width="860" height="390" fill="#fbfcff"></rect>
      <text x="430" y="190" text-anchor="middle" fill="#8a93aa" font-size="14">当前假设走不完 536 千米</text>
      <text x="430" y="214" text-anchor="middle" fill="#a5aec2" font-size="11">请缩短“减速前运行时间”或降低速度</text>
    `;
    els.chartCaption.textContent = '调整假设后，这里会重新画出速度—时间图。';
    return;
  }

  const actual = state.actualRevealed ? state.actualZhengzhouArrival : null;
  const times = [result.departure, result.slowStart, result.arrival, state.plannedZhengzhouArrival];
  if (actual) times.push(actual);

  const minT = Math.floor((Math.min(...times) - 20) / 10) * 10;
  const maxT = Math.ceil((Math.max(...times) + 25) / 10) * 10;
  const W = 860;
  const H = 390;
  const L = 58;
  const R = 26;
  const T = 58;
  const B = 48;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const yMax = Math.max(360, Math.ceil((state.v1 + 30) / 60) * 60);
  const x = (t) => L + ((t - minT) / (maxT - minT)) * plotW;
  const y = (v) => T + plotH - (v / yMax) * plotH;

  let grid = '';
  for (let t = Math.ceil(minT / 30) * 30; t <= maxT; t += 30) {
    const px = x(t);
    grid += `<line x1="${px.toFixed(1)}" y1="${T}" x2="${px.toFixed(1)}" y2="${T + plotH}" class="chart-grid"/>`;
    grid += svgText(px, H - 22, formatClock(t), 'chart-axis-label', 'text-anchor="middle"');
  }
  for (let v = 0; v <= yMax; v += 60) {
    const py = y(v);
    grid += `<line x1="${L}" y1="${py.toFixed(1)}" x2="${L + plotW}" y2="${py.toFixed(1)}" class="chart-grid"/>`;
    grid += svgText(L - 10, py + 3, String(v), 'chart-axis-label', 'text-anchor="end"');
  }

  const points = [];
  points.push([result.departure, 0]);
  if (state.accel > 0) {
    points.push([result.departure + state.accel, state.v1]);
  } else {
    points.push([result.departure, state.v1]);
  }
  points.push([result.slowStart, state.v1]);
  if (state.decel > 0) {
    points.push([result.slowEnd, state.v2]);
  } else {
    points.push([result.slowStart, state.v2]);
  }
  points.push([result.arrival - state.brake, state.v2]);
  points.push([result.arrival, 0]);

  const linePath = points
    .map(([t, v], index) => `${index === 0 ? 'M' : 'L'} ${x(t).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${x(result.arrival).toFixed(1)} ${y(0).toFixed(1)} L ${x(
    result.departure
  ).toFixed(1)} ${y(0).toFixed(1)} Z`;

  const plateauStart = state.decel > 0 ? result.slowEnd : result.slowStart;
  const plateauEnd = Math.max(plateauStart, result.arrival - state.brake);
  const plateauBand =
    plateauEnd > plateauStart
      ? `<rect x="${x(plateauStart).toFixed(1)}" y="${y(state.v2).toFixed(1)}" width="${(
          x(plateauEnd) - x(plateauStart)
        ).toFixed(1)}" height="${(y(0) - y(state.v2)).toFixed(1)}" class="chart-band"/>`
      : '';

  const planX = x(state.plannedZhengzhouArrival);
  const estimateX = x(result.arrival);
  const actualX = actual ? x(actual) : null;

  const labelAnchor = (px) => {
    if (px > L + plotW - 68) return ['end', -4];
    if (px < L + 68) return ['start', 4];
    return ['middle', 0];
  };

  const planAnchor = labelAnchor(planX);
  const estAnchor = labelAnchor(estimateX);
  const actualAnchor = actualX ? labelAnchor(actualX) : null;

  let markers = '';
  markers += `<line x1="${planX.toFixed(1)}" y1="${T}" x2="${planX.toFixed(1)}" y2="${T + plotH}" class="chart-line chart-line--plan"/>`;
  markers += svgText(
    planX + planAnchor[1],
    19,
    `计划 ${formatClock(state.plannedZhengzhouArrival)}`,
    'chart-vlabel',
    `text-anchor="${planAnchor[0]}" fill="#b8731f"`
  );

  markers += `<line x1="${estimateX.toFixed(1)}" y1="${T}" x2="${estimateX.toFixed(1)}" y2="${T + plotH}" class="chart-line chart-line--estimate"/>`;
  markers += svgText(
    estimateX + estAnchor[1],
    36,
    `估计 ${formatClock(result.arrivalRounded)}`,
    'chart-vlabel',
    `text-anchor="${estAnchor[0]}" fill="#3e47a8"`
  );

  if (actualX) {
    markers += `<line x1="${actualX.toFixed(1)}" y1="${T}" x2="${actualX.toFixed(1)}" y2="${T + plotH}" class="chart-line chart-line--actual"/>`;
    markers += svgText(
      actualX + actualAnchor[1],
      53,
      `实际 ${formatClock(actual)}`,
      'chart-vlabel',
      `text-anchor="${actualAnchor[0]}" fill="#1f7d61"`
    );
  }

  const departureDotY = state.accel > 0 ? y(0) : y(state.v1);
  const departureDot = `<circle cx="${x(result.departure).toFixed(1)}" cy="${departureDotY.toFixed(
    1
  )}" r="3.5" class="chart-dot"/>`;
  const slowDot = `<circle cx="${x(result.slowStart).toFixed(1)}" cy="${y(state.v1).toFixed(
    1
  )}" r="3" class="chart-dot"/>`;
  const arrivalDot = `<circle cx="${estimateX.toFixed(1)}" cy="${y(0).toFixed(
    1
  )}" r="3.5" class="chart-dot"/>`;

  const annotations = `
    ${svgText(
      x(result.departure) + 7,
      (state.accel > 0 ? y(0) : y(state.v1)) - 9,
      '发车',
      'chart-annotation',
      'text-anchor="start"'
    )}
    ${svgText(x(result.slowStart) + 6, y(state.v1) + 16, '开始减速', 'chart-annotation', 'text-anchor="start"')}
    ${svgText(estimateX - 7, y(0) - 10, '到站', 'chart-annotation', 'text-anchor="end"')}
  `;

  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4b55b8" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#4b55b8" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fbfcff"/>
    ${grid}
    <line x1="${L}" y1="${T + plotH}" x2="${L + plotW}" y2="${T + plotH}" class="chart-axis"/>
    <line x1="${L}" y1="${T}" x2="${L}" y2="${T + plotH}" class="chart-axis"/>
    ${svgText(L - 46, 18, '速度 (千米/时)', 'chart-axis-title', 'text-anchor="start"')}
    ${svgText(L + plotW, H - 6, '时刻', 'chart-axis-title', 'text-anchor="end"')}
    ${plateauBand}
    <path d="${areaPath}" class="chart-area"/>
    <path d="${linePath}" class="chart-line"/>
    ${markers}
    ${departureDot}
    ${slowDot}
    ${arrivalDot}
    ${annotations}
  `;

  const modelName = modelLabel();
  const actualText = actual ? `绿色虚线是实际到站 ${formatClock(actual)}。` : '实际到站要等“检验”环节再揭晓。';
  els.chartCaption.textContent = `${modelName}：折线下的面积就是路程。${actualText}`;
}

function renderBreakdown(result) {
  if (!result.valid) {
    els.distanceBeforeBar.style.width = '0%';
    els.distanceAfterBar.style.width = '0%';
    els.distanceBeforeLabel.textContent = '—';
    els.distanceAfterLabel.textContent = '—';
    els.formulaList.innerHTML = '<p class="formula-empty">当前假设不成立，暂时没有可用的算式。</p>';
    els.formulaNote.textContent = '请先调整参数，让各段路程加起来等于 536 千米。';
    return;
  }

  const before = Math.max(0, result.beforeSlowDistance);
  const after = Math.max(0, result.distance - before);
  const beforePct = (before / result.distance) * 100;
  const afterPct = 100 - beforePct;

  els.distanceBeforeBar.style.width = `${beforePct}%`;
  els.distanceAfterBar.style.width = `${afterPct}%`;
  els.distanceBeforeLabel.textContent = formatKm(before);
  els.distanceAfterLabel.textContent = formatKm(after);
  els.distanceTag.textContent = modelLabel();

  const rows = [];
  rows.push(['武汉发车', `${formatClock(state.actualWuhanArrival)} + ${state.dwell} 分 = ${formatClock(result.departure)}`]);
  rows.push(['开始减速', `${formatClock(result.departure)} + ${state.preSlow} 分 = ${formatClock(result.slowStart)}`]);
  rows.push(['减速前路程', formatKm(before)]);
  rows.push(['限速段路程', formatKm(result.plateauDistance)]);
  rows.push([
    '限速段用时',
    `${result.plateauDistance.toFixed(1)} ÷ ${state.v2} × 60 ≈ ${result.plateauMinutes.toFixed(1)} 分`,
  ]);
  rows.push(['到站时刻', `${formatClock(result.arrival, true)} ≈ ${formatClock(result.arrivalRounded)}`]);
  rows.push(['预计晚点', `${formatClock(result.arrivalRounded)} − 15:26 = ${result.delayRounded} 分`]);

  els.formulaList.innerHTML = rows
    .map(
      ([label, value], index) =>
        `<div class="formula-row${index === rows.length - 1 ? ' formula-row--total' : ''}"><span>${label}</span><strong>${value}</strong></div>`
    )
    .join('');

  const rounding = Number.isInteger(result.arrival)
    ? `到站时刻恰好是整分钟，报成 ${formatClock(result.arrivalRounded)}。`
    : `最后把 ${formatClock(result.arrival, true)} 向上取整到分钟，报成 ${formatClock(result.arrivalRounded)}。`;
  const transitionNote =
    state.accel || state.decel || state.brake
      ? '减速前路程已包含加速和降速段，限速段路程已扣除进站制动。'
      : '简洁模型忽略加速、降速和制动过程。';
  els.formulaNote.textContent = `${rounding}${transitionNote}`;
}

function speedLabel(segment) {
  switch (segment.key) {
    case 'dwell':
      return '0';
    case 'accel':
      return `0 → ${state.v1}`;
    case 'cruise':
      return String(state.v1);
    case 'decel':
      return `${state.v1} → ${state.v2}`;
    case 'plateau':
      return String(state.v2);
    case 'brake':
      return `${state.v2} → 0`;
    default:
      return String(Math.round(segment.speed));
  }
}

function renderTable(result) {
  if (!result.valid) {
    els.segmentTableBody.innerHTML = `<tr><td colspan="4">当前假设走不完 536 千米，无法列出分段表。</td></tr>`;
    els.segmentTableFoot.innerHTML = '';
    return;
  }

  els.segmentTableBody.innerHTML = result.segments
    .map(
      (segment) => `
        <tr>
          <td>
            <span class="seg-name">
              <i class="seg-dot seg-dot--${segment.tone}"></i>
              <span>${segment.label}<small>${segment.detail}</small></span>
            </span>
          </td>
          <td><span class="mono">${speedLabel(segment)}</span></td>
          <td class="num">${segment.minutes.toFixed(1)}</td>
          <td class="num">${segment.km.toFixed(1)}</td>
        </tr>
      `
    )
    .join('');

  els.segmentTableFoot.innerHTML = `
    <tr>
      <td>合计 <small class="mono">（含停站 ${state.dwell} 分）</small></td>
      <td></td>
      <td class="num">${result.totalFromActual.toFixed(1)}</td>
      <td class="num">${result.distance.toFixed(1)}</td>
    </tr>
  `;
}

function renderComparison(result) {
  const actual = state.actualZhengzhouArrival;

  if (!result.valid) {
    els.cmpEstimate.textContent = '—';
    els.cmpEstimateDelay.textContent = '当前假设不成立';
    els.cmpActual.textContent = formatClock(actual);
    els.cmpError.textContent = '—';
    els.cmpErrorCard.classList.remove('is-late');
    els.errorBanner.textContent = result.errors[0] || '请先调整假设，再比较误差。';
    els.requiredSpeedText.textContent = '当前假设无法完成 536 千米，先调整参数。';
    els.solveBtn.hidden = true;
    renderCompareChart(null);
    return;
  }

  const error = result.arrivalRounded - actual;
  const absError = Math.abs(error);

  els.cmpEstimate.textContent = formatClock(result.arrivalRounded);
  els.cmpEstimateDelay.textContent = delayText(result.delayRounded);
  els.cmpActual.textContent = formatClock(actual);
  els.cmpError.textContent = errorText(error);
  els.cmpErrorCard.classList.toggle('is-late', error > 0);

  if (error < 0) {
    els.errorBanner.textContent = `你的估计比实际早 ${absError} 分钟。对赶时间的人来说，这 ${absError} 分钟足够让接站的人多等一会儿。`;
  } else if (error > 0) {
    els.errorBanner.textContent = `你的估计比实际晚 ${absError} 分钟。这说明模型把某段速度估得偏低，或把限速持续的时间估长了。`;
  } else {
    els.errorBanner.textContent = '你的估计与实际到站时刻相同。别忘了说明：这是模型碰巧对上，还是假设真的合理。';
  }

  const solved = solveLimitedSpeed(actual, state);
  if (solved && Number.isFinite(solved)) {
    // 向上取整，保证按滑块可设的整数速度能“不晚于”实际到站时刻。
    const solvedRounded = Math.ceil(solved - 1e-9);
    const capped = clamp(solvedRounded, 100, 240);
    const capNote = capped !== solvedRounded ? `（滑块上限 240，实际需要约 ${solvedRounded}）` : '';
    els.requiredSpeedText.textContent = `如果其余假设不变，限速后平均速度约需 ${capped} 千米/时，才能 ${formatClock(
      actual
    )} 到站${capNote}。`;
    els.solveBtn.textContent = `把限速后速度改为 ${capped}`;
    els.solveBtn.dataset.speed = String(capped);
    els.solveBtn.hidden = false;
  } else {
    els.requiredSpeedText.textContent = '按当前假设，无法通过只改“限速后速度”让列车在 16:13 到站。';
    els.solveBtn.hidden = true;
  }

  renderCompareChart(result);
  renderPrompt(result);
}

function renderPrompt(result) {
  if (!els.promptThird) return;
  if (!result.valid) {
    els.promptThird.textContent = '“当前假设还不成立，先调整参数。”';
    return;
  }
  if (!state.actualRevealed) {
    els.promptThird.textContent = '“先保留估计，拿到实际记录后，再比较误差。”';
    return;
  }
  const error = result.arrivalRounded - state.actualZhengzhouArrival;
  const absError = Math.abs(error);
  const direction = error < 0 ? '偏早' : error > 0 ? '偏晚' : '刚好相同';
  els.promptThird.innerHTML = `“实际是 ${formatClock(
    state.actualZhengzhouArrival
  )}，我们估计${direction}${error === 0 ? '' : ` <strong>${absError}</strong> 分钟`}；最值得再查的是 <strong>限速后的真实速度</strong>。”`;
}

function renderCompareChart(result) {
  const svg = els.compareChart;
  if (!svg) return;

  if (!result || !result.valid) {
    svg.innerHTML = `<rect x="0" y="0" width="860" height="260" fill="#fff"></rect>
      <text x="430" y="130" text-anchor="middle" fill="#8a93aa" font-size="12">暂无可比较的估计</text>`;
    return;
  }

  const W = 860;
  const H = 260;
  const L = 82;
  const R = 26;
  const T = 26;
  const B = 36;
  const plotW = W - L - R;
  const actual = state.actualZhengzhouArrival;
  const times = [
    state.plannedWuhanDeparture,
    state.plannedZhengzhouArrival,
    result.departure,
    result.arrivalRounded,
    actual,
  ];
  const minT = Math.floor((Math.min(...times) - 10) / 30) * 30;
  const maxT = Math.ceil((Math.max(...times) + 10) / 30) * 30;
  const x = (t) => L + ((t - minT) / (maxT - minT)) * plotW;

  const lanes = [
    { label: '计划', start: state.plannedWuhanDeparture, end: state.plannedZhengzhouArrival, tone: 'plan', value: formatClock(state.plannedZhengzhouArrival) },
    { label: '估计', start: result.departure, end: result.arrivalRounded, tone: 'estimate', value: formatClock(result.arrivalRounded) },
    { label: '实际', start: result.departure, end: actual, tone: 'actual', value: formatClock(actual) },
  ];

  let ticks = '';
  for (let t = Math.ceil(minT / 30) * 30; t <= maxT; t += 30) {
    const px = x(t);
    ticks += `<line x1="${px.toFixed(1)}" y1="${T}" x2="${px.toFixed(1)}" y2="${H - B}" stroke="#edf0f7" stroke-width="1"/>`;
    ticks += svgText(px, H - 12, formatClock(t), 'compare-tick', 'text-anchor="middle"');
  }

  let lanesSvg = '';
  lanes.forEach((lane, index) => {
    const cy = T + 34 + index * 64;
    const startX = x(lane.start);
    const endX = x(lane.end);
    const barWidth = Math.max(6, endX - startX);
    const valueAnchor = endX > L + plotW - 58 ? 'end' : 'start';
    const valueX = valueAnchor === 'end' ? endX - 8 : endX + 8;

    lanesSvg += `<rect x="0" y="${cy - 23}" width="${W}" height="46" class="compare-lane" rx="8"/>`;
    lanesSvg += svgText(12, cy + 4, lane.label, 'compare-label', 'text-anchor="start"');
    lanesSvg += `<line x1="${startX.toFixed(1)}" y1="${cy}" x2="${endX.toFixed(1)}" y2="${cy}" class="compare-track"/>`;
    lanesSvg += `<line x1="${startX.toFixed(1)}" y1="${cy}" x2="${(startX + barWidth).toFixed(
      1
    )}" y2="${cy}" class="compare-bar compare-bar--${lane.tone}"/>`;
    lanesSvg += `<circle cx="${startX.toFixed(1)}" cy="${cy}" r="3.5" class="compare-dot compare-dot--${lane.tone}"/>`;
    lanesSvg += `<circle cx="${endX.toFixed(1)}" cy="${cy}" r="4.5" class="compare-dot compare-dot--${lane.tone}"/>`;
    lanesSvg += svgText(
      valueX,
      cy - 11,
      lane.value,
      'compare-value',
      `text-anchor="${valueAnchor}"`
    );
    lanesSvg += svgText(startX + 4, cy + 18, formatClock(lane.start), 'compare-value', 'text-anchor="start"');
  });

  const planX = x(state.plannedZhengzhouArrival);
  const planLine = `<line x1="${planX.toFixed(1)}" y1="${T}" x2="${planX.toFixed(1)}" y2="${H - B}" stroke="#e0a04b" stroke-width="1.2" stroke-dasharray="4 4"/>`;

  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
    ${ticks}
    ${lanesSvg}
    ${planLine}
    ${svgText(planX, 16, '计划 15:26', 'compare-tick', 'text-anchor="middle"')}
  `;

  const caption = $('#compareCaption');
  if (caption) {
    caption.textContent = '实际发车时刻没有给出，图中的实际时间线按估计发车时刻画出。';
  }
}

function renderPrintSummary(result) {
  const target = $('#printSummary');
  if (!target) return;
  if (!result.valid) {
    target.innerHTML = '<p>当前假设无法完成 536 千米，请调整参数后再打印。</p>';
    return;
  }
  const model = modelLabel();
  let checkLine = '<p><strong>检验：</strong>尚未拆封实际记录。</p>';
  if (state.actualRevealed) {
    const error = result.arrivalRounded - state.actualZhengzhouArrival;
    const direction = error < 0 ? '偏早' : error > 0 ? '偏晚' : '刚好相同';
    checkLine = `<p><strong>检验：</strong>实际 ${formatClock(
      state.actualZhengzhouArrival
    )} 到站，晚点 47 分钟；估计${direction}${error === 0 ? '' : ` ${Math.abs(error)} 分钟`}。最值得再查：限速后的真实速度。</p>`;
  }
  target.innerHTML = `
    <h3>本组假设与第一版估计</h3>
    <p><strong>估计到站：</strong>${formatClock(result.arrivalRounded)}，${delayText(result.delayRounded)}。</p>
    <p><strong>假设：</strong>武汉站停站 ${state.dwell} 分钟；出站 ${state.preSlow} 分钟后开始减速；减速前 ${state.v1} 千米/时；限速后 ${state.v2} 千米/时；${model}。</p>
    <p><strong>里程校验：</strong>减速前 ${result.beforeSlowDistance.toFixed(1)} + 减速后 ${(
      result.distance - result.beforeSlowDistance
    ).toFixed(1)} = ${result.distance.toFixed(1)} 千米。</p>
    ${checkLine}
  `;
}

function renderReport(result) {
  if (!result.valid) {
    els.reportText.textContent =
      '当前假设无法完成 536 千米，请先调整“减速前运行时间”“正常速度”或“限速后速度”，再生成汇报稿。';
    els.promptArrival.textContent = '—';
    els.promptDelay.textContent = '—';
    els.promptThird.textContent = '“当前假设还不成立，先调整参数。”';
    return;
  }

  const modelDesc =
    state.accel === 0 && state.decel === 0 && state.brake === 0
      ? '把全程分成“正常速度 + 限速速度”两段'
      : '把全程分成“启动加速、正常速度、降至限速、限速运行、进站制动”几段';

  let text = `我们按“武汉站停站 ${state.dwell} 分钟、出站 ${state.preSlow} 分钟后开始减速、减速前 ${state.v1} 千米/时、限速后 ${state.v2} 千米/时”，${modelDesc}来估算。G80 约在 ${formatClock(
    result.arrivalRounded
  )} 到达郑州东，比计划 15:26 ${result.delayRounded >= 0 ? '晚' : '早'} ${Math.abs(
    result.delayRounded
  )} 分钟。`;

  if (state.actualRevealed) {
    const error = result.arrivalRounded - state.actualZhengzhouArrival;
    const absError = Math.abs(error);
    const direction = error < 0 ? '偏早' : error > 0 ? '偏晚' : '刚好相同';
    text += `检验资料显示实际 ${formatClock(
      state.actualZhengzhouArrival
    )} 到站、晚点 47 分钟，我们的估计${direction}${error === 0 ? '' : ` ${absError} 分钟`}。`;
    text += `最值得再查的假设是“限速后能否一直保持 ${state.v2} 千米/时”，因为显示屏上的 180 只是某一时段的读数，实际速度可能更低或持续更久。`;
  } else {
    text += '拿到实际记录后，还要比较估计误差，并解释哪一条假设最可能把结果推早或推晚。';
  }

  els.reportText.textContent = text;
  els.promptArrival.textContent = formatClock(result.arrivalRounded);
  els.promptDelay.textContent = String(Math.abs(result.delayRounded));
  renderPrompt(result);
}

function updateFromInput(input) {
  const key = input.dataset.bind;
  if (!key) return;
  state[key] = Number(input.value);
  updateRangeFill(input);
  setOutput(key, state[key]);
  markPreset();
  scheduleRender();
}

function setPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  Object.assign(state, preset);
  ['accel', 'decel', 'brake'].forEach((key) => {
    const input = getInput(key);
    if (input) {
      input.value = state[key];
      updateRangeFill(input);
      setOutput(key, state[key]);
    }
  });
  markPreset();
  renderAll();
}

function resetAll() {
  const revealed = state.actualRevealed;
  Object.assign(state, DEFAULTS, { actualRevealed: revealed });
  syncControls();
  renderAll();
  showToast('已恢复默认假设。');
}

function revealActual() {
  state.actualRevealed = true;
  document.body.classList.add('has-revealed');
  els.sealedCard.hidden = true;
  els.actualPanel.hidden = false;
  els.legendActual.hidden = false;
  renderAll();
  els.actualPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resealActual() {
  state.actualRevealed = false;
  document.body.classList.remove('has-revealed');
  els.actualPanel.hidden = true;
  els.sealedCard.hidden = false;
  els.legendActual.hidden = true;
  renderAll();
  els.sealedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2200);
}

async function copyReport() {
  const group = [
    els.classInput?.value.trim(),
    els.groupInput?.value.trim(),
    els.membersInput?.value.trim(),
    els.recorderInput?.value.trim(),
  ].filter(Boolean);

  const text = `${group.length ? `${group.join(' · ')}\n\n` : ''}${els.reportText.textContent}`;

  try {
    await navigator.clipboard.writeText(text);
    showToast('汇报稿已复制。');
  } catch (error) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      showToast('汇报稿已复制。');
    } catch (fallbackError) {
      showToast('复制失败，请手动选中文字。');
    } finally {
      area.remove();
    }
  }
}

function restoreGroupFields() {
  const fields = [
    [els.classInput, 'g80-class'],
    [els.groupInput, 'g80-group'],
    [els.membersInput, 'g80-members'],
    [els.recorderInput, 'g80-recorder'],
  ];
  fields.forEach(([input, key]) => {
    if (!input) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved) input.value = saved;
      input.addEventListener('input', () => {
        try {
          localStorage.setItem(key, input.value);
        } catch (error) {
          /* 隐私模式下忽略存储失败 */
        }
      });
    } catch (error) {
      /* 忽略存储失败 */
    }
  });
}

function initNavObserver() {
  const sections = $$('main section[id]');
  const links = $$('[data-nav]');
  if (!sections.length || !links.length) return;

  const setActive = (id) => {
    links.forEach((link) => {
      const active = link.dataset.nav === id;
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    { rootMargin: '-28% 0px -60% 0px', threshold: 0 }
  );

  sections.forEach((section) => observer.observe(section));
}

function initSnow() {
  const canvas = $('#snowCanvas');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let flakes = [];
  let width = 0;
  let height = 0;
  let visible = true;
  let running = false;

  const makeFlake = (randomY = false) => ({
    x: Math.random() * width,
    y: randomY ? Math.random() * height : -10,
    r: 0.8 + Math.random() * 1.8,
    vy: 0.18 + Math.random() * 0.55,
    vx: -0.06 + Math.random() * 0.18,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.25 + Math.random() * 0.55,
  });

  const resize = () => {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(78, Math.max(28, width / 18)));
    flakes = Array.from({ length: count }, () => makeFlake(true));
  };

  const draw = () => {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);
    flakes.forEach((flake) => {
      flake.phase += 0.012;
      flake.x += flake.vx + Math.sin(flake.phase) * 0.06;
      flake.y += flake.vy;
      if (flake.y > height + 6) {
        Object.assign(flake, makeFlake(false));
      }
      if (flake.x < -6) flake.x = width + 6;
      if (flake.x > width + 6) flake.x = -6;
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226, 240, 255, ${flake.alpha})`;
      ctx.fill();
    });
    snowRaf = requestAnimationFrame(draw);
  };

  const start = () => {
    if (running) return;
    running = true;
    snowRaf = requestAnimationFrame(draw);
  };

  const stop = () => {
    running = false;
    if (snowRaf) cancelAnimationFrame(snowRaf);
    snowRaf = null;
  };

  resize();
  start();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (visible) start();
    }, 150);
  });

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    },
    { threshold: 0 }
  );
  observer.observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (visible) start();
  });
}

function bindEvents() {
  $$('[data-bind]').forEach((input) => {
    input.addEventListener('input', () => updateFromInput(input));
  });

  $$('.preset').forEach((button) => {
    button.addEventListener('click', () => setPreset(button.dataset.preset));
  });

  $('#resetBtn')?.addEventListener('click', resetAll);
  els.revealBtn?.addEventListener('click', revealActual);
  els.resealBtn?.addEventListener('click', resealActual);
  els.copyBtn?.addEventListener('click', copyReport);

  els.solveBtn?.addEventListener('click', () => {
    if (!state.actualRevealed) return;
    const speed = Number(els.solveBtn.dataset.speed);
    if (!Number.isFinite(speed)) return;
    state.v2 = clamp(speed, 100, 240);
    const input = getInput('v2');
    if (input) {
      input.value = state.v2;
      updateRangeFill(input);
      setOutput('v2', state.v2);
    }
    markPreset();
    renderAll();
    showToast(`已把限速后速度改为 ${state.v2} 千米/时，估计结果已更新。`);
  });

  $$('.print-trigger').forEach((button) => {
    button.addEventListener('click', () => window.print());
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.activeElement?.blur();
    }
  });
}

function applyInitialReveal() {
  // 方便老师直接分享“已拆封”的课堂页面；普通访问仍然保持先估后验。
  const params = new URLSearchParams(window.location.search);
  if (params.get('revealed') !== '1') return;
  state.actualRevealed = true;
  document.body.classList.add('has-revealed');
  els.sealedCard.hidden = true;
  els.actualPanel.hidden = false;
  els.legendActual.hidden = false;
}

function init() {
  cacheElements();
  restoreGroupFields();
  applyInitialReveal();
  syncControls();
  bindEvents();
  renderAll();
  initNavObserver();
  initSnow();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
