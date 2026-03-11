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

// ═══════════════════════════════════════
//  CSV 拖放导入功能
// ═══════════════════════════════════════

const csvDropZone = $('#csvDropZone');
const csvFileInput = $('#csvFileInput');
const csvStatus = $('#csvStatus');

// 点击拖放区域触发文件选择
csvDropZone.addEventListener('click', () => csvFileInput.click());

// 拖放事件
csvDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  csvDropZone.classList.add('drag-over');
});

csvDropZone.addEventListener('dragleave', () => {
  csvDropZone.classList.remove('drag-over');
});

csvDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  csvDropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    processCSVFile(files[0]);
  }
});

// 文件选择事件
csvFileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    processCSVFile(e.target.files[0]);
  }
});

// 解析CSV文件
function processCSVFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showCSVStatus('请选择 CSV 格式文件', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const csv = e.target.result;
      const trades = parseTradingViewCSV(csv);
      
      if (trades.length === 0) {
        showCSVStatus('未找到有效的交易记录', 'error');
        return;
      }

      // 清空现有交易
      $('#tradeList').innerHTML = '';
      
      // 添加解析出的交易
      trades.forEach((trade, i) => {
        const row = createTradeRow(i);
        $('#tradeList').appendChild(row);
        row.querySelector('.trade-dir').value = trade.direction;
        row.querySelector('.trade-entry').value = trade.entry;
        
        if (tradeMode === 'price' && row.querySelector('.trade-exit')) {
          row.querySelector('.trade-exit').value = trade.exit;
        }
        if (tradeMode === 'pct' && row.querySelector('.trade-pct')) {
          const pct = trade.direction === 'long' 
            ? ((trade.exit - trade.entry) / trade.entry * 100).toFixed(2)
            : ((trade.entry - trade.exit) / trade.entry * 100).toFixed(2);
          row.querySelector('.trade-pct').value = pct;
        }
      });

      renumberTrades();
      showCSVStatus(`成功导入 ${trades.length} 笔交易`, 'success');
      
      // 自动触发计算
      setTimeout(calculate, 300);
    } catch (err) {
      console.error(err);
      showCSVStatus('CSV解析失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function showCSVStatus(msg, type) {
  csvStatus.textContent = msg;
  csvStatus.className = 'csv-status ' + type;
  setTimeout(() => {
    csvStatus.className = 'csv-status';
    csvStatus.textContent = '';
  }, 4000);
}

// 解析 TradingView CSV
function parseTradingViewCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // 解析表头 - 使用制表符或逗号分隔
  const headers = lines[0].split(/[\t,]/).map(h => h.toLowerCase().replace(/"/g, '').trim());
  
  console.log('CSV Headers:', headers);
  
  // 查找关键列索引
  const colIndex = {
    tradeNo: headers.findIndex(h => h.includes('交易') || h.includes('trade #') || h === 'trade'),
    type: headers.findIndex(h => h.includes('类型') || h.includes('type')),
    time: headers.findIndex(h => h.includes('时间') || h.includes('time') || h.includes('date')),
    price: headers.findIndex(h => h.includes('价格') || h.includes('price')),
    quantity: headers.findIndex(h => h.includes('仓位大小') || h.includes('quantity') || h.includes('size')),
  };

  console.log('Column indices:', colIndex);

  // 解析数据行
  const rawTrades = [];
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    
    // 尝试用制表符分割，如果没有则用逗号
    let cols = line.split('\t');
    if (cols.length < 2 || cols[0] === '') {
      cols = parseCSVLine(line);
    }
    
    if (cols.length < 3) continue;

    // 清理数值中的逗号
    const cleanNum = (s) => {
      if (!s) return 0;
      return parseFloat(s.toString().replace(/,/g, '').replace(/"/g, '')) || 0;
    };

    rawTrades.push({
      lineIndex: i,
      tradeNo: colIndex.tradeNo >= 0 ? cols[colIndex.tradeNo] : '',
      type: colIndex.type >= 0 ? cols[colIndex.type] : '',
      time: colIndex.time >= 0 ? cols[colIndex.time] : '',
      price: colIndex.price >= 0 ? cleanNum(cols[colIndex.price]) : 0,
    });
  }

  console.log('Raw trades:', rawTrades);

  // 配对进场和出场
  return pairEntryExit(rawTrades, colIndex);
}

// 配对进场和出场记录
function pairEntryExit(rawTrades, colIndex) {
  const pairs = [];
  
  // 按交易编号分组
  const tradeGroups = {};
  for (const t of rawTrades) {
    const no = t.tradeNo;
    if (!no) continue;
    if (!tradeGroups[no]) tradeGroups[no] = [];
    tradeGroups[no].push(t);
  }

  console.log('Trade groups:', tradeGroups);

  // 处理每组
  for (const key in tradeGroups) {
    const group = tradeGroups[key];
    
    // 找进场和出场
    let entry = null, exit = null;
    
    for (const t of group) {
      const type = t.type.toLowerCase();
      if (type.includes('进场') || type.includes('入场') || 
          type.includes('开仓') || type.includes('entry') || 
          type.includes('open') || type.includes('进')) {
        if (!entry) entry = t;
      }
      if (type.includes('出场') || type.includes('平仓') || 
          type.includes('exit') || type.includes('close') || 
          type.includes('出')) {
        if (!exit) exit = t;
      }
    }

    // 如果没有明确配对，尝试根据时间排序
    if ((!entry || !exit) && group.length >= 2) {
      // 按时间排序，第一条是进场，最后一条是出场
      group.sort((a, b) => a.time.localeCompare(b.time));
      entry = group[0];
      exit = group[group.length - 1];
    }

    if (entry && exit && entry.price > 0 && exit.price > 0) {
      // 判断方向
      const entryType = entry.type.toLowerCase();
      let direction = 'long';
      
      if (entryType.includes('空头') || entryType.includes('short') || 
          entryType.includes('卖') || entryType.includes('空')) {
        direction = 'short';
      }
      
      pairs.push({
        entry: entry.price,
        exit: exit.price,
        direction: direction,
        time: entry.time
      });
    }
  }

  // 按时间排序
  pairs.sort((a, b) => a.time.localeCompare(b.time));
  
  console.log('Paired trades:', pairs);
  return pairs;
}

// 解析CSV单行
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

// 从CSV行提取交易数据 (兼容旧格式)
function extractTradeFromRow(columns, format) {
  switch (format) {
    case 'simple':
      return parseSimpleFormat(columns);
    case 'full':
    case 'zh_full':
      return parseFullFormat(columns);
    case 'position':
    default:
      return parsePositionFormat(columns);
  }
}

// 格式1: 简单格式 - 时间,开仓,平仓,方向
function parseSimpleFormat(columns) {
  // 列: 时间, 开仓价, 平仓价, 方向(buy/sell或多/空)
  // 或: 时间, 类型(开仓/平仓), 品种, 方向, 价格
  
  // 尝试找到开仓和平仓价格
  let entry = null, exit = null, direction = 'long';
  
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i].toLowerCase();
    const val = parseFloat(columns[i]);
    
    if (!isNaN(val) && val > 0) {
      // 根据列名或位置判断
      if (col.includes('开仓') || col.includes('entry') || col.includes('open')) {
        if (entry === null) entry = val;
      }
      if (col.includes('平仓') || col.includes('exit') || col.includes('close')) {
        if (exit === null) exit = val;
      }
    }
    
    // 方向
    if (col.includes('买') || col.includes('long') || col.includes('buy')) {
      direction = 'long';
    } else if (col.includes('卖') || col.includes('short') || col.includes('sell')) {
      direction = 'short';
    }
  }
  
  // 如果没有通过列名找到，尝试位置匹配
  if (entry === null || exit === null) {
    const nums = columns.filter(c => !isNaN(parseFloat(c)) && parseFloat(c) > 0).map(c => parseFloat(c));
    if (nums.length >= 2) {
      // 假设第一列是开仓，第二列是平仓
      entry = nums[0];
      exit = nums[1];
    }
  }
  
  if (entry && exit) {
    return { entry, exit, direction };
  }
  return null;
}

// 格式2: 完整格式 - 需要配对开仓和平仓
function parseFullFormat(columns) {
  // 找关键列
  let time, type, symbol, direction, price;
  
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i].toLowerCase().replace(/"/g, '');
    
    if (col === 'time' || col === '时间' || col === 'date') time = columns[i];
    if (col === 'type' || col === '类型') type = columns[i];
    if (col === 'symbol' || col === '品种' || col === '产品') symbol = columns[i];
    if (col === 'direction' || col === '方向') direction = columns[i];
    if (col === 'price' || col === '价格' || col === 'exec price') price = parseFloat(columns[i]);
  }
  
  // 如果没找到，根据位置推断
  if (price === undefined || isNaN(price)) {
    // 尝试找数字列
    for (const c of columns) {
      const n = parseFloat(c);
      if (!isNaN(n) && n > 0) {
        price = n;
        break;
      }
    }
  }
  
  if (price === undefined || isNaN(price)) return null;
  
  // 判断是多还是空
  let dir = 'long';
  if (direction) {
    const d = direction.toLowerCase();
    if (d.includes('sell') || d.includes('short') || d.includes('卖')) dir = 'short';
  }
  
  return {
    entry: price,
    exit: price,
    direction: dir,
    time,
    type,
    symbol
  };
}

// 格式3: 位置匹配格式 (默认)
function parsePositionFormat(columns) {
  // 尝试从列位置提取数据
  // 假设格式: 时间, 开仓价, 平仓价, 方向
  // 或者: 时间, 类型, 价格, 方向
  
  const nums = [];
  let direction = 'long';
  
  for (let i = 0; i < columns.length; i++) {
    const val = parseFloat(columns[i].replace(/"/g, ''));
    if (!isNaN(val) && val > 0) {
      nums.push(val);
    }
    
    const lower = columns[i].toLowerCase();
    if (lower.includes('sell') || lower.includes('short') || lower.includes('卖')) {
      direction = 'short';
    }
  }
  
  // 至少需要两个价格
  if (nums.length < 2) return null;
  
  // 第一笔作为开仓，后续作为平仓（需要配对处理）
  // 这里简化处理：返回第一对价格
  return {
    entry: nums[0],
    exit: nums[1],
    direction
  };
}

// 配对开仓和平仓记录（用于完整格式）
function pairTrades(records) {
  const pairs = [];
  const stack = [];
  
  for (const rec of records) {
    if (rec.type && rec.type.toLowerCase().includes('open')) {
      stack.push(rec);
    } else if (rec.type && rec.type.toLowerCase().includes('close')) {
      if (stack.length > 0) {
        const open = stack.pop();
        pairs.push({
          entry: open.price,
          exit: rec.price,
          direction: open.direction
        });
      }
    }
  }
  
  return pairs;
}
