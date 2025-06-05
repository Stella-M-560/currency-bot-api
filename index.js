// index.js - 支持实时汇率 + 10年历史数据
const HISTORY_YEARS = 10; // 支持查询的历史年份跨度

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const { searchParams, pathname } = new URL(request.url);
  const action = pathname.split('/')[1] || 'convert'; // 判断请求类型

  // 路由处理
  switch (action) {
    case 'convert':
      return handleRealTimeConversion(searchParams);
    case 'history':
      return handleHistoricalData(searchParams);
    default:
      return formatResponse('❌ 无效的API端点', 404);
  }
}

// 实时汇率换算
async function handleRealTimeConversion(params) {
  const from = (params.get('from') || 'USD').toUpperCase();
  const to = (params.get('to') || 'CNY').toUpperCase();
  const amount = parseFloat(params.get('amount')) || 1;

  if (!validateCurrency(from) || !validateCurrency(to)) {
    return formatResponse('❌ 货币代码必须是3位大写字母（如USD/CNY）', 400);
  }

  try {
    // 获取实时汇率（带缓存）
    const rate = await fetchWithCache(
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      data => data.rates[to]
    );

    return formatResponse([
      `💱 ${amount} ${from} = ${formatCurrency(to, amount * rate)}`,
      `📊 实时汇率: 1 ${from} = ${rate.toFixed(6)} ${to}`,
      `📈 [查看10年走势](${new URL(request.url).origin}/history?from=${from}&to=${to})`
    ].join('\n'));

  } catch (error) {
    return handleFallbackConversion(from, to, amount);
  }
}

// 历史汇率数据（10年）
async function handleHistoricalData(params) {
  const from = (params.get('from') || 'USD').toUpperCase();
  const to = (params.get('to') || 'CNY').toUpperCase();

  if (!validateCurrency(from) || !validateCurrency(to)) {
    return formatResponse('❌ 无效货币代码', 400);
  }

  try {
    // 获取每年1月1日的历史数据
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - HISTORY_YEARS);

    const apiUrl = `https://api.frankfurter.app/${formatDate(startDate)}..${formatDate(endDate)}?from=${from}&to=${to}&amount=1`;
    const historyData = await fetchWithCache(apiUrl, processHistoryData);

    // 生成ASCII走势图
    const chart = generateHistoryChart(historyData, from, to);

    return formatResponse([
      `📅 ${from}/${to} 近${HISTORY_YEARS}年汇率走势`,
      '📆 每年1月1日数据:',
      chart,
      `\n🔢 详细数据: ${JSON.stringify(historyData, null, 2)}`
    ].join('\n'));

  } catch (error) {
    return formatResponse('❌ 历史数据获取失败', 502);
  }
}

// 辅助函数：验证货币代码
function validateCurrency(currency) {
  return /^[A-Z]{3}$/.test(currency);
}

// 辅助函数：带缓存的API请求
async function fetchWithCache(url, dataProcessor) {
  const cacheKey = new Request(url);
  const cached = await caches.default.match(cacheKey);
  if (cached) return dataProcessor(await cached.json());

  const response = await fetch(url);
  if (!response.ok) throw new Error('API请求失败');

  const data = await response.json();
  const result = dataProcessor(data);

  // 缓存结果（实时数据缓存5分钟，历史数据缓存1天）
  const cacheTTL = url.includes('latest') ? 300 : 86400;
  event.waitUntil(
    caches.default.put(
      cacheKey,
      new Response(JSON.stringify(data), {
        headers: { 'Cache-Control': `max-age=${cacheTTL}` }
      })
    )
  );

  return result;
}

// 辅助函数：处理历史数据
function processHistoryData(data) {
  const result = {};
  for (const [date, rates] of Object.entries(data.rates)) {
    if (date.endsWith('-01-01')) { // 只保留每年1月1日数据
      result[date.substring(0, 4)] = Object.values(rates)[0];
    }
  }
  return result;
}

// 辅助函数：生成ASCII走势图
function generateHistoryChart(data, from, to) {
  const values = Object.values(data);
  const maxRate = Math.max(...values);
  const minRate = Math.min(...values);
  const scale = 10 / (maxRate - minRate);

  let chart = '';
  Object.entries(data).forEach(([year, rate]) => {
    const barLength = Math.round((rate - minRate) * scale);
    chart += `${year}: ${'█'.repeat(barLength)} ${rate.toFixed(4)} ${to}\n`;
  });

  return `\n${chart}\n📌 峰值: ${maxRate.toFixed(4)} | 谷值: ${minRate.toFixed(4)}`;
}

// 其他辅助函数（formatCurrency, formatResponse等保持不变，沿用之前版本）
