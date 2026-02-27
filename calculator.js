// ═══════════════════════════════════════
//  Core Calculation Engine
// ═══════════════════════════════════════

class LeverageCalculator {
  constructor(params) {
    this.principal = params.principal;
    this.leverage = params.leverage;
    this.contractSize = params.contractSize;
    this.lotStep = params.lotStep;
    this.marginRatio = params.marginRatio / 100;
    this.direction = params.direction;
    this.compounding = params.compounding;
  }

  floorToStep(value) {
    return Math.max(this.lotStep, Math.floor(value / this.lotStep) * this.lotStep);
  }

  calcTrade(balance, entry, exit, direction) {
    const tradeCapital = balance * this.marginRatio;
    const rawLots = (tradeCapital * this.leverage) / (this.contractSize * entry);
    const lots = this.floorToStep(rawLots);
    const units = lots * this.contractSize;
    const margin = (units * entry) / this.leverage;
    const contractValue = units * entry;
    const effectiveLeverage = contractValue / balance;

    const priceDiff = direction === 'long' ? exit - entry : entry - exit;
    const profit = units * priceDiff;
    const profitPct = (profit / balance) * 100;

    const freeMargin = balance - margin;
    const maxDDPrice = units > 0 ? freeMargin / units : 0;
    const maxDDPct = (maxDDPrice / entry) * 100;

    const liquidationPrice = direction === 'long'
      ? entry - maxDDPrice
      : entry + maxDDPrice;

    return {
      direction,
      balanceBefore: balance,
      tradeCapital,
      lots: Math.round(lots * 1000) / 1000,
      units,
      margin,
      contractValue,
      effectiveLeverage,
      entry,
      exit,
      profit,
      profitPct,
      maxDDPrice,
      maxDDPct,
      liquidationPrice,
      freeMargin,
      balanceAfter: balance + profit,
    };
  }

  run(trades) {
    let balance = this.principal;
    const results = [];
    const balanceCurve = [balance];

    for (const t of trades) {
      const dir = t.direction || this.direction;
      const result = this.calcTrade(balance, t.entry, t.exit, dir);
      results.push(result);

      if (this.compounding) {
        balance = result.balanceAfter;
      } else {
        balance = this.principal + results.reduce((s, r) => s + r.profit, 0);
      }
      balanceCurve.push(balance);
    }

    const finalBalance = balance;
    const totalProfit = finalBalance - this.principal;
    const totalReturn = (totalProfit / this.principal) * 100;

    return { results, balanceCurve, finalBalance, totalProfit, totalReturn };
  }
}

// ═══════════════════════════════════════
//  UI Controller
// ═══════════════════════════════════════

let tradeMode = 'price';
let tradeCount = 0;
let growthChart = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Slider ↔ Number input sync
$('#marginRatio').addEventListener('input', (e) => {
  $('#marginRatioInput').value = e.target.value;
  updateLotsPreview();
});

$('#marginRatioInput').addEventListener('input', (e) => {
  let v = parseFloat(e.target.value);
  if (!isNaN(v)) {
    v = Math.max(1, Math.min(100, v));
    $('#marginRatio').value = v;
  }
  updateLotsPreview();
});

$('#principal').addEventListener('input', updateLotsPreview);
$('#leverage').addEventListener('input', updateLotsPreview);
$('#lotStep').addEventListener('input', updateLotsPreview);

function getContractSizeValue() {
  const opt = $('#assetSelect').selectedOptions[0];
  return opt.value === 'custom'
    ? (parseFloat($('#contractSize').value) || 1)
    : (parseFloat(opt.value) || 1);
}

function updateLotsPreview() {
  const principal = parseFloat($('#principal').value) || 0;
  const leverage = parseFloat($('#leverage').value) || 1;
  const contractSize = getContractSizeValue();
  const lotStep = parseFloat($('#lotStep').value) || 0.01;
  const ratio = (parseFloat($('#marginRatioInput').value) || 10) / 100;

  const firstEntry = document.querySelector('.trade-row .trade-entry');
  const entryPrice = firstEntry ? parseFloat(firstEntry.value) : NaN;

  const el = $('#lotsPreview');
  if (isNaN(entryPrice) || entryPrice <= 0 || principal <= 0) {
    el.textContent = `持仓资金 $${(principal * ratio).toFixed(2)} · 需输入入场价计算手数`;
    return;
  }

  const tradeCapital = principal * ratio;
  const rawLots = (tradeCapital * leverage) / (contractSize * entryPrice);
  const lots = Math.max(lotStep, Math.floor(rawLots / lotStep) * lotStep);
  const lotsDisplay = lots.toFixed(Math.max(2, -Math.floor(Math.log10(lotStep))));

  el.textContent = `持仓资金 $${tradeCapital.toFixed(2)} · ≈ ${lotsDisplay} 手`;
}

// Asset selector
$('#assetSelect').addEventListener('change', (e) => {
  const opt = e.target.selectedOptions[0];
  const info = opt.dataset.info || '';
  const step = parseFloat(opt.dataset.step) || 0.01;
  $('#assetInfo').textContent = info;
  $('#lotStep').value = step;

  if (opt.value === 'custom') {
    $('#customContractGroup').style.display = '';
    $('#lotStep').readOnly = false;
    $('#lotStep').style.opacity = '1';
    $('#lotStep').style.cursor = '';
  } else {
    $('#customContractGroup').style.display = 'none';
    $('#contractSize').value = opt.value;
    $('#lotStep').readOnly = true;
    $('#lotStep').style.opacity = '.7';
    $('#lotStep').style.cursor = 'default';
  }
  updateLotsPreview();
});

$('#contractSize').addEventListener('input', updateLotsPreview);

// Tab switching
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    tradeMode = tab.dataset.mode;
    rebuildTradeList();
  });
});

function createTradeRow(index) {
  const div = document.createElement('div');
  div.className = 'trade-row';
  div.dataset.index = index;

  const dirSelect = `<select class="trade-dir"><option value="long">多</option><option value="short">空</option></select>`;

  if (tradeMode === 'price') {
    div.innerHTML = `
      <span class="trade-num">#${index + 1}</span>
      ${dirSelect}
      <input type="number" class="trade-entry" placeholder="入场价" step="any">
      <span style="color:var(--text-dim)">→</span>
      <input type="number" class="trade-exit" placeholder="出场价" step="any">
      <button class="remove-btn" title="删除">×</button>
    `;
  } else {
    div.innerHTML = `
      <span class="trade-num">#${index + 1}</span>
      ${dirSelect}
      <input type="number" class="trade-entry" placeholder="入场价" step="any">
      <input type="number" class="trade-pct" placeholder="涨跌幅%" step="any">
      <span style="color:var(--text-dim);font-size:12px">%</span>
      <button class="remove-btn" title="删除">×</button>
    `;
  }

  div.querySelector('.remove-btn').addEventListener('click', () => {
    div.remove();
    renumberTrades();
  });

  return div;
}

function renumberTrades() {
  $$('.trade-row').forEach((row, i) => {
    row.dataset.index = i;
    row.querySelector('.trade-num').textContent = `#${i + 1}`;
  });
}

function rebuildTradeList() {
  const list = $('#tradeList');
  const existing = [];
  $$('.trade-row').forEach(row => {
    const entry = row.querySelector('.trade-entry')?.value || '';
    const exit = row.querySelector('.trade-exit')?.value || '';
    const pct = row.querySelector('.trade-pct')?.value || '';
    const dir = row.querySelector('.trade-dir')?.value || 'long';
    existing.push({ entry, exit, pct, dir });
  });

  list.innerHTML = '';
  if (existing.length === 0) {
    addDefaultTrades();
    return;
  }

  existing.forEach((data, i) => {
    const row = createTradeRow(i);
    list.appendChild(row);
    row.querySelector('.trade-dir').value = data.dir;
    row.querySelector('.trade-entry').value = data.entry;
    if (tradeMode === 'price' && row.querySelector('.trade-exit')) {
      row.querySelector('.trade-exit').value = data.exit;
    }
    if (tradeMode === 'pct' && row.querySelector('.trade-pct')) {
      row.querySelector('.trade-pct').value = data.pct;
    }
  });
}

function addDefaultTrades() {
  const list = $('#tradeList');
  list.appendChild(createTradeRow(0));
}

$('#tradeList').addEventListener('input', (e) => {
  if (e.target.classList.contains('trade-entry') && e.target.closest('.trade-row')?.dataset.index === '0') {
    updateLotsPreview();
  }
});

$('#addTrade').addEventListener('click', () => {
  const list = $('#tradeList');
  const index = list.children.length;
  list.appendChild(createTradeRow(index));
});

$('#clearTrades').addEventListener('click', () => {
  $('#tradeList').innerHTML = '';
});

function gatherTrades() {
  const trades = [];
  $$('.trade-row').forEach(row => {
    const entry = parseFloat(row.querySelector('.trade-entry')?.value);
    if (isNaN(entry) || entry <= 0) return;
    const direction = row.querySelector('.trade-dir')?.value || 'long';

    if (tradeMode === 'price') {
      const exit = parseFloat(row.querySelector('.trade-exit')?.value);
      if (isNaN(exit) || exit <= 0) return;
      trades.push({ entry, exit, direction });
    } else {
      const pct = parseFloat(row.querySelector('.trade-pct')?.value);
      if (isNaN(pct)) return;
      const exit = direction === 'long'
        ? entry * (1 + pct / 100)
        : entry * (1 - pct / 100);
      trades.push({ entry, exit, direction });
    }
  });
  return trades;
}

function formatNum(n, decimals = 2) {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e4) return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return n.toFixed(decimals);
}

function formatUSD(n) {
  return '$' + formatNum(n);
}

// ═══════════════════════════════════════
//  Render Results
// ═══════════════════════════════════════

function renderSummary(data) {
  const { finalBalance, totalProfit, totalReturn, results } = data;
  const lastTrade = results[results.length - 1];
  const avgLeverage = results.reduce((s, r) => s + r.effectiveLeverage, 0) / results.length;
  const minDD = Math.min(...results.map(r => r.maxDDPct));

  const profitClass = totalProfit >= 0 ? 'card-green' : 'card-red';

  $('#summaryCards').innerHTML = `
    <div class="card ${profitClass}">
      <div class="card-label">最终净值</div>
      <div class="card-value">${formatUSD(finalBalance)}</div>
      <div class="card-sub">${totalReturn >= 0 ? '+' : ''}${formatNum(totalReturn)}%</div>
    </div>
    <div class="card ${profitClass}">
      <div class="card-label">总盈亏</div>
      <div class="card-value">${totalProfit >= 0 ? '+' : ''}${formatUSD(totalProfit)}</div>
      <div class="card-sub">${results.length} 笔交易</div>
    </div>
    <div class="card card-accent">
      <div class="card-label">平均实际杠杆</div>
      <div class="card-value">${formatNum(avgLeverage, 1)}x</div>
    </div>
    <div class="card card-yellow">
      <div class="card-label">最小可回调空间</div>
      <div class="card-value">${formatNum(minDD, 2)}%</div>
      <div class="card-sub">最危险的一笔</div>
    </div>
  `;
}

function renderChart(data) {
  const { balanceCurve } = data;
  const labels = balanceCurve.map((_, i) => i === 0 ? '初始' : `第${i}笔`);

  if (growthChart) growthChart.destroy();

  const ctx = $('#growthChart').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(79,140,255,.3)');
  gradient.addColorStop(1, 'rgba(79,140,255,.02)');

  growthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '账户净值',
        data: balanceCurve,
        borderColor: '#4f8cff',
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: '#4f8cff',
        pointBorderColor: '#1a1d27',
        pointBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => '净值: $' + formatNum(ctx.parsed.y)
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,.05)' },
          ticks: { color: '#8b8fa3' }
        },
        y: {
          grid: { color: 'rgba(255,255,255,.05)' },
          ticks: {
            color: '#8b8fa3',
            callback: (v) => '$' + formatNum(v)
          }
        }
      }
    }
  });
}

function renderTable(data) {
  const { results } = data;

  let html = `<table class="result-table">
    <thead><tr>
      <th>#</th>
      <th>方向</th>
      <th>入场→出场</th>
      <th>交易前余额</th>
      <th>手数</th>
      <th>保证金</th>
      <th>合约价值</th>
      <th>实际杠杆</th>
      <th>盈亏</th>
      <th>盈亏%</th>
      <th>可回调$</th>
      <th>可回调%</th>
      <th>爆仓价</th>
      <th>交易后余额</th>
    </tr></thead><tbody>`;

  results.forEach((r, i) => {
    const profitClass = r.profit >= 0 ? 'profit-positive' : 'profit-negative';
    const dirLabel = r.direction === 'long' ? '多' : '空';
    const dirClass = r.direction === 'long' ? 'profit-positive' : 'profit-negative';
    html += `<tr>
      <td>${i + 1}</td>
      <td class="${dirClass}" style="font-weight:600">${dirLabel}</td>
      <td>${r.entry.toFixed(2)} → ${r.exit.toFixed(2)}</td>
      <td>${formatUSD(r.balanceBefore)}</td>
      <td>${r.lots.toFixed(2)}</td>
      <td>${formatUSD(r.margin)}</td>
      <td>${formatUSD(r.contractValue)}</td>
      <td>${r.effectiveLeverage.toFixed(2)}x</td>
      <td class="${profitClass}">${r.profit >= 0 ? '+' : ''}${formatUSD(r.profit)}</td>
      <td class="${profitClass}">${r.profitPct >= 0 ? '+' : ''}${r.profitPct.toFixed(2)}%</td>
      <td>$${r.maxDDPrice.toFixed(2)}</td>
      <td>${r.maxDDPct.toFixed(2)}%</td>
      <td>${r.liquidationPrice.toFixed(2)}</td>
      <td style="font-weight:600">${formatUSD(r.balanceAfter)}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  $('#tradeTable').innerHTML = html;
}

// ═══════════════════════════════════════
//  Main Calculate
// ═══════════════════════════════════════

function calculate() {
  const assetOpt = $('#assetSelect').selectedOptions[0];
  const contractSize = assetOpt.value === 'custom'
    ? (parseFloat($('#contractSize').value) || 1)
    : (parseFloat(assetOpt.value) || 1);

  const params = {
    principal: parseFloat($('#principal').value) || 0,
    leverage: parseFloat($('#leverage').value) || 1,
    contractSize,
    lotStep: parseFloat($('#lotStep').value) || 0.01,
    marginRatio: parseFloat($('#marginRatio').value) || 10,
    direction: 'long',
    compounding: $('#compounding').checked,
  };

  if (params.principal <= 0) {
    alert('请输入有效的初始本金');
    return;
  }

  const trades = gatherTrades();
  if (trades.length === 0) {
    alert('请至少添加一笔交易');
    return;
  }

  const calc = new LeverageCalculator(params);
  const data = calc.run(trades);

  renderSummary(data);
  renderChart(data);
  renderTable(data);
}

$('#calculate').addEventListener('click', calculate);

// ═══════════════════════════════════════
//  Risk Assessment (ATR Stop Loss)
// ═══════════════════════════════════════

function syncRiskEntry() {
  const firstRow = document.querySelector('.trade-row[data-index="0"]');
  if (!firstRow) return;
  const entryVal = firstRow.querySelector('.trade-entry')?.value;
  const dirVal = firstRow.querySelector('.trade-dir')?.value;
  if (entryVal) $('#riskEntry').value = entryVal;
  if (dirVal) $('#riskDir').value = dirVal;
  updateRisk();
}

function updateRiskRatio() {
  const slMult = parseFloat($('#riskATRMult').value) || 0;
  const tpMult = parseFloat($('#riskTPMult').value) || 0;
  const ratioEl = $('#riskRatioValue');
  if (slMult > 0 && tpMult > 0) {
    const rr = tpMult / slMult;
    ratioEl.textContent = `1 : ${rr % 1 === 0 ? rr : rr.toFixed(2)}`;
  } else {
    ratioEl.textContent = '—';
  }
}

$('#riskATRMult').addEventListener('input', () => {
  const slMult = parseFloat($('#riskATRMult').value) || 0;
  if (slMult > 0) {
    const currentTP = parseFloat($('#riskTPMult').value);
    const currentRatio = currentTP / slMult;
    if (isNaN(currentTP) || currentTP <= 0) {
      $('#riskTPMult').value = (slMult * 2).toFixed(1).replace(/\.0$/, '');
    }
  }
  updateRiskRatio();
  updateRisk();
});

$('#riskTPMult').addEventListener('input', () => {
  updateRiskRatio();
  updateRisk();
});

function updateRisk() {
  const el = $('#riskResult');
  const dir = $('#riskDir').value;
  const entry = parseFloat($('#riskEntry').value);
  const atr = parseFloat($('#riskATR').value);
  const slMult = parseFloat($('#riskATRMult').value);
  const tpMult = parseFloat($('#riskTPMult').value);

  updateRiskRatio();

  if (isNaN(entry) || entry <= 0 || isNaN(atr) || atr <= 0 || isNaN(slMult) || slMult <= 0) {
    el.innerHTML = '<div class="risk-result-placeholder">输入 ATR 后自动计算止损/止盈</div>';
    return;
  }

  const stopDist = atr * slMult;
  const stopPrice = dir === 'long' ? entry - stopDist : entry + stopDist;

  const hasTp = !isNaN(tpMult) && tpMult > 0;
  const tpDist = hasTp ? atr * tpMult : 0;
  const tpPrice = hasTp ? (dir === 'long' ? entry + tpDist : entry - tpDist) : 0;

  const principal = parseFloat($('#principal').value) || 0;
  const leverage = parseFloat($('#leverage').value) || 1;
  const contractSize = getContractSizeValue();
  const lotStep = parseFloat($('#lotStep').value) || 0.01;
  const ratio = (parseFloat($('#marginRatioInput').value) || 5) / 100;

  const tradeCapital = principal * ratio;
  const rawLots = (tradeCapital * leverage) / (contractSize * entry);
  const lots = Math.max(lotStep, Math.floor(rawLots / lotStep) * lotStep);
  const units = lots * contractSize;
  const lotsDecimals = Math.max(2, -Math.floor(Math.log10(lotStep)));

  const stopLoss = units * stopDist;
  const stopLossPct = principal > 0 ? (stopLoss / principal) * 100 : 0;

  const takeProfit = hasTp ? units * tpDist : 0;
  const takeProfitPct = hasTp && principal > 0 ? (takeProfit / principal) * 100 : 0;

  const dirLabel = dir === 'long' ? '做多' : '做空';
  const slArrow = dir === 'long' ? '↓' : '↑';
  const tpArrow = dir === 'long' ? '↑' : '↓';

  let html = `
    <div class="risk-item">
      <span class="risk-label">方向</span>
      <span class="risk-value neutral">${dirLabel}</span>
    </div>
    <div class="risk-item">
      <span class="risk-label">持仓手数</span>
      <span class="risk-value neutral">${lots.toFixed(lotsDecimals)} 手</span>
    </div>
    <hr class="risk-divider">
    <div class="risk-item">
      <span class="risk-label">止损距离 (ATR×${slMult})</span>
      <span class="risk-value warn">${stopDist.toFixed(4)}</span>
    </div>
    <div class="risk-item">
      <span class="risk-label">止损价格</span>
      <span class="risk-value warn">${entry.toFixed(2)} ${slArrow} ${stopPrice.toFixed(2)} (${(stopDist / entry * 100).toFixed(2)}%)</span>
    </div>
    <div class="risk-item">
      <span class="risk-label">止损亏损</span>
      <span class="risk-value loss">-$${formatNum(stopLoss)} (${stopLossPct.toFixed(2)}%)</span>
    </div>`;

  if (hasTp) {
    html += `
    <hr class="risk-divider">
    <div class="risk-item">
      <span class="risk-label">止盈距离 (ATR×${tpMult})</span>
      <span class="risk-value profit">${tpDist.toFixed(4)}</span>
    </div>
    <div class="risk-item">
      <span class="risk-label">止盈价格</span>
      <span class="risk-value profit">${entry.toFixed(2)} ${tpArrow} ${tpPrice.toFixed(2)} (+${(tpDist / entry * 100).toFixed(2)}%)</span>
    </div>
    <div class="risk-item">
      <span class="risk-label">止盈收益</span>
      <span class="risk-value profit">+$${formatNum(takeProfit)} (${takeProfitPct.toFixed(2)}%)</span>
    </div>`;
  }

  el.innerHTML = html;
}

$('#riskEntry').addEventListener('input', updateRisk);
$('#riskATR').addEventListener('input', updateRisk);
$('#riskDir').addEventListener('change', updateRisk);
$('#principal').addEventListener('input', updateRisk);
$('#leverage').addEventListener('input', updateRisk);
$('#marginRatio').addEventListener('input', updateRisk);
$('#marginRatioInput').addEventListener('input', updateRisk);
$('#assetSelect').addEventListener('change', () => setTimeout(updateRisk, 0));

// Sync entry price & direction from trade row #1 on input
$('#tradeList').addEventListener('input', (e) => {
  const row = e.target.closest('.trade-row');
  if (row && row.dataset.index === '0') {
    if (e.target.classList.contains('trade-entry')) {
      $('#riskEntry').value = e.target.value;
      updateRisk();
    }
  }
});
$('#tradeList').addEventListener('change', (e) => {
  const row = e.target.closest('.trade-row');
  if (row && row.dataset.index === '0' && e.target.classList.contains('trade-dir')) {
    $('#riskDir').value = e.target.value;
    updateRisk();
  }
});

// Init — sync lot step from default selected asset
function syncAssetDefaults() {
  const opt = $('#assetSelect').selectedOptions[0];
  if (opt && opt.value !== 'custom') {
    $('#lotStep').value = parseFloat(opt.dataset.step) || 0.01;
    $('#assetInfo').textContent = opt.dataset.info || '';
  }
}

syncAssetDefaults();
addDefaultTrades();
updateLotsPreview();
