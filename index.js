// index.js - 完整版汇率API (动态10年历史范围)
const HISTORY_YEARS = 10; // 可配置的年数

// 主事件监听
addEventListener('fetch', event => {
  event.respondWith(
    handleRequest(event.request).catch(err => {
      return formatResponse(`❌ 服务器错误: ${err.message}`, 500);
    })
  );
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const { searchParams } = url;

  // 路由处理
  if (url.pathname.startsWith('/history')) {
    return handleHistoricalData(searchParams);
  } else {
    return handleRealTimeConversion(searchParams);
  }
}

// ================ 实时汇率处理 ================
async function handleRealTimeConversion(params) {
  const from = (params.get('from') || 'USD').toUpperCase();
  const to = (params.get('to') || 'CNY').toUpperCase();
  const amount = parseFloat(params.get('amount')) || 1;

  if (!validateCurrency(from) || !validateCurrency(to)) {
    return formatResponse('❌ 货币代码必须是3位大写字母（如USD/CNY）', 400);
  }

  try {
    const apiUrl = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
    const response = await fetchWithCache(apiUrl, 300); // 缓存5分钟
    
    if (!response.ok) throw new Error(`API响应失败: ${response.status}`);
    
    const data = await response.json();
    const rate = data.rates[to];
    const result = (amount * rate).toFixed(2);

    return formatResponse([
      `💱 ${amount} ${from} = ${formatCurrency(to, result)}`,
      `📊 实时汇率: 1 ${from} = ${rate.toFixed(6)} ${to}`,
      `📈 [查看${HISTORY_YEARS}年历史](${new URL(request.url).origin}/history?from=${from}&to=${to})`
    ].join('\n'));

  } catch (error) {
    return formatResponse(`❌ 实时汇率获取失败: ${error.message}`, 502);
  }
}

// ================ 历史数据处理 ================
async function handleHistoricalData(params) {
  const from = (params.get('from') || 'USD').toUpperCase();
  const to = (params.get('to') || 'CNY').toUpperCase();

  if (!validateCurrency(from) || !validateCurrency(to)) {
    return formatResponse('❌ 无效货币代码', 400);
  }

  try {
    // 动态计算日期范围（当前日期往前推HISTORY_YEARS年）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - HISTORY_YEARS);

    const apiUrl = `https://api.frankfurter.app/${formatDate(startDate)}..${formatDate(endDate)}?from=${from}&to=${to}`;
    const response = await fetchWithCache(apiUrl, 86400); // 缓存1天
    
    if (!response.ok) throw new Error('历史API请求失败');
    
    const data = await response.json();
    const table = generateHistoryTable(data, from, to, startDate, endDate);

    return formatResponse(table);

  } catch (error) {
    return formatResponse(`❌ 历史数据获取失败: ${error.message}`, 502);
  }
}

// ================ 辅助函数 ================
// 带缓存的fetch请求
async function fetchWithCache(url, ttl = 60) {
  const cache = caches.default;
  const cachedResponse = await cache.match(url);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(url);
  if (!response.ok) return response;

  const responseToCache = response.clone();
  event.waitUntil(
    cache.put(url, responseToCache, { expirationTtl: ttl })
  );
  return response;
}

// 生成历史数据表格（动态年份范围）
function generateHistoryTable(data, from, to, startDate, endDate) {
  const yearlyStats = {};
  const allRates = [];
  
  // 计算每年统计指标
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

  // 生成Markdown表格
  let table = `
| 年份  | 最低值  | 最高值  | 平均值  | 波动幅度 |
|-------|---------|---------|---------|----------|\n`;

  Object.keys(yearlyStats)
    .sort()
    .forEach(year => {
      const { min, max, sum, count } = yearlyStats[year];
      const avg = (sum / count).toFixed(4);
      const fluctuation = ((max - min) / min * 100).toFixed(2) + '%';
      
      table += `| ${year} | ${min.toFixed(4)} | ${max.toFixed(4)} | ${avg} | ${fluctuation} |\n`;
    });

  // 整体统计
  const overallMin = Math.min(...allRates).toFixed(4);
  const overallMax = Math.max(...allRates).toFixed(4);
  const overallAvg = (allRates.reduce((a, b) => a + b, 0) / allRates.length).toFixed(4);
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  return [
    `📊 **${from}/${to} 近${HISTORY_YEARS}年统计（${startYear}-${endYear}）**`,
    `📅 数据范围: ${formatDisplayDate(startDate)} 至 ${formatDisplayDate(endDate)}`,
    '',
    table,
    '',
    `📌 **整体趋势**`,
    `- 历史最低: ${overallMin} ${to}`,
    `- 历史最高: ${overallMax} ${to}`,
    `- ${HISTORY_YEARS}年平均: ${overallAvg} ${to}`,
    `- 数据更新: ${new Date().toISOString().split('T')[0]}`
  ].join('\n');
}

// 日期格式化（API请求用）
function formatDate(date) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

// 日期格式化（显示用）
function formatDisplayDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('zh-CN', options); // 示例：2025年6月20日
}

// 货币格式化
function formatCurrency(currency, value) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value).replace(/\s/g, '');
}

// 货币代码验证
function validateCurrency(currency) {
  return /^[A-Z]{3}$/.test(currency);
}

// 标准化响应
function formatResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
