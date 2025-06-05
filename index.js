// index.js - 完整修复版 (Cloudflare Worker)
const DEFAULT_HISTORY_YEARS = 10;

// 货币别名库
const CURRENCY_ALIAS = {
  'USD': 'USD', '美金': 'USD', '美元': 'USD',
  'CNY': 'CNY', '人民币': 'CNY', 'rmb': 'CNY',
  'JPY': 'JPY', '日元': 'JPY', 'EUR': 'EUR', '欧元': 'EUR',
  'GBP': 'GBP', '英镑': 'GBP'
};

// 单位换算
const UNIT_MAP = {
  '万': 1e4, 'w': 1e4, '亿': 1e8,
  'k': 1e3, 'K': 1e3, 'm': 1e6, 'M': 1e6
};

// 主入口
addEventListener('fetch', event => {
  event.respondWith(
    handleRequest(event.request).catch(err => {
      return formatResponse(`❌ 系统错误: ${err.message}`, 500);
    })
  );
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const { searchParams, pathname } = url;
  
  // 解析参数
  let { from, to, amount, timeRange, error } = parseParams(searchParams);
  if (error) return formatResponse(error, 400);

  try {
    return pathname.startsWith('/history') 
      ? handleHistoricalData(from, to, timeRange)
      : handleRealTimeConversion(from, to, amount);
  } catch (err) {
    return formatResponse(`❌ 处理失败: ${err.message}`, 500);
  }
}

// ================ 参数解析 ================
function parseParams(params) {
  let from = normalizeCurrency(params.get('from'));
  let to = normalizeCurrency(params.get('to'));
  const amount = parseInputAmount(params.get('amount'));
  const timeRange = params.get('range') || '10年';

  if (!from || !to) return { error: '❌ 无法识别货币对' };
  if (isNaN(amount)) return { error: '❌ 金额格式无效' };

  return { from, to, amount, timeRange };
}

function parseInputAmount(input) {
  if (!input) return 1;
  
  const match = input.match(/^([0-9,.]+)\s*([万千亿KMkm]+)?/);
  if (!match) return NaN;
  
  let num = parseFloat(match[1].replace(/,/g, ''));
  if (match[2] && UNIT_MAP[match[2]]) {
    num *= UNIT_MAP[match[2]];
  }
  
  return num;
}

function normalizeCurrency(input) {
  if (!input) return null;
  const cleaned = input.toString().toUpperCase().replace(/[^A-Z\u4e00-\u9fa5]/g, '');
  return CURRENCY_ALIAS[cleaned] || Object.keys(CURRENCY_ALIAS).find(key => 
    key.includes(cleaned) || cleaned.includes(key)
  );
}

// ================ 实时汇率 ================
async function handleRealTimeConversion(from, to, amount) {
  const apiUrl = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
  const response = await fetchWithCache(apiUrl, 300); // 缓存5分钟
  
  if (!response.ok) throw new Error('汇率API不可用');
  
  const data = await response.json();
  const rate = data.rates[to];
  const result = (amount * rate).toFixed(2);
  
  return formatResponse([
    `💱 ${formatLargeNumber(amount)} ${from} = ${formatCurrency(to, result)}`,
    `📊 1 ${from} = ${rate.toFixed(6)} ${to}`,
    `💡 需要历史数据请告诉我时间段（如"过去5年"）`
  ].join('\n'));
}

// ================ 历史数据 ================
async function handleHistoricalData(from, to, timeRange) {
  const { startDate, endDate, description } = parseTimeRange(timeRange);
  const apiUrl = `https://api.frankfurter.app/${formatDate(startDate)}..${formatDate(endDate)}?from=${from}&to=${to}`;
  const response = await fetchWithCache(apiUrl, 86400); // 缓存1天
  
  if (!response.ok) throw new Error('历史数据API不可用');
  
  const data = await response.json();
  return formatResponse(
    generateHistoryTable(data, from, to, description)
  );
}

function parseTimeRange(input) {
  const now = new Date();
  const start = new Date(now);
  let description = '近10年';

  const matches = input.match(/(过去|最近)?(\d+)(年|个月|月)/);
  if (matches) {
    const num = parseInt(matches[2]);
    const unit = matches[3];
    
    if (unit === '年' || unit === '年') {
      // 处理闰日问题
      const targetYear = now.getFullYear() - num;
      start.setFullYear(targetYear);
      
      // 如果当前是闰日(2月29日)且目标年份不是闰年
      if (now.getMonth() === 1 && now.getDate() === 29) {
        const isTargetLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
        if (!isTargetLeap) {
          start.setMonth(1, 28); // 非闰年设置为2月28日
        }
      }
      description = `过去${num}年`;
    } else {
      // 处理月份计算
      const totalMonths = now.getMonth() - num;
      start.setMonth(totalMonths);
      
      // 处理跨年和日期不一致问题
      if (start.getDate() !== now.getDate()) {
        start.setDate(0); // 设置为上个月的最后一天
      }
      description = `过去${num}个月`;
    }
  } else {
    // 默认10年处理
    start.setFullYear(now.getFullYear() - DEFAULT_HISTORY_YEARS);
    // 处理闰日
    if (now.getMonth() === 1 && now.getDate() === 29) {
      const targetYear = now.getFullYear() - DEFAULT_HISTORY_YEARS;
      const isTargetLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
      if (!isTargetLeap) {
        start.setMonth(1, 28);
      }
    }
  }

  return { startDate: start, endDate: now, description };
}

function generateHistoryTable(data, from, to, description) {
  const yearlyStats = {};
  const allRates = [];
  
  // 统计年度数据
  Object.entries(data.rates).forEach(([date, rates]) => {
    const year = date.substring(0, 4);
    const rate = rates[to];
    allRates.push(rate);
    
    if (!yearlyStats[year]) {
      yearlyStats[year] = { min: rate, max: rate, sum: rate, count: 1 };
    } else {
      yearlyStats[year].min = Math.min(yearlyStats[year].min, rate);
      yearlyStats[year].max = Math.max(yearlyStats[year].max, rate);
      yearlyStats[year].sum += rate;
      yearlyStats[year].count++;
    }
  });

  // 生成表格
  let table = `| 年份 | 最低值 | 最高值 | 平均值 | 波动幅度 |\n|------|--------|--------|--------|----------|\n`;
  
  Object.keys(yearlyStats)
    .sort()
    .forEach(year => {
      const { min, max, sum, count } = yearlyStats[year];
      table += `| ${year} | ${min.toFixed(4)} | ${max.toFixed(4)} | ${(sum/count).toFixed(4)} | ${((max-min)/min*100).toFixed(2)}% |\n`;
    });

  // 整体统计
  const overallMin = Math.min(...allRates).toFixed(4);
  const overallMax = Math.max(...allRates).toFixed(4);
  const overallAvg = (allRates.reduce((a, b) => a + b, 0) / allRates.length).toFixed(4);
  const lastDate = Object.keys(data.rates).pop();

  return [
    `📊 **${from}/${to} ${description}汇率统计**`,
    `📅 数据范围: ${formatDisplayDate(new Date(data.start_date))} 至 ${formatDisplayDate(new Date(data.end_date))}`,
    '',
    table,
    '',
    `📌 整体趋势`,
    `- 历史最低: ${overallMin} ${to}`,
    `- 历史最高: ${overallMax} ${to}`,
    `- 期间平均: ${overallAvg} ${to}`,
    `- 更新日期: ${lastDate}`
  ].join('\n');
}

// ================ 辅助函数 ================
async function fetchWithCache(url, ttl) {
  const cache = caches.default;
  const cached = await cache.match(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) return response;

  const responseToCache = response.clone();
  event.waitUntil(
    cache.put(url, responseToCache, { expirationTtl: ttl })
  );
  return response;
}

function formatLargeNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

function formatCurrency(currency, value) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value).replace(/\s/g, '');
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDisplayDate(date) {
  return date.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

function formatResponse(body, status = 200) {
  return new Response(body, {
   
