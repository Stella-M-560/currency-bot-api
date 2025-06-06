// index.js - Cloudflare Worker (修复版)
const DEFAULT_HISTORY_YEARS = 10;

// 货币别名库
const CURRENCY_ALIAS = {
  'USD': 'USD', '美金': 'USD', '美元': 'USD', '刀': 'USD',
  'CNY': 'CNY', '人民币': 'CNY', 'rmb': 'CNY', '软妹币': 'CNY',
  'JPY': 'JPY', '日元': 'JPY', '倭元': 'JPY',
  'EUR': 'EUR', '欧元': 'EUR',
  'GBP': 'GBP', '英镑': 'GBP',
  'CAD': 'CAD', '加元': 'CAD',
  'AUD': 'AUD', '澳元': 'AUD',
  'CHF': 'CHF', '瑞士法郎': 'CHF',
  'HKD': 'HKD', '港币': 'HKD', '港元': 'HKD'
};

// 单位换算
const UNIT_MAP = {
  '万': 1e4, 'w': 1e4, '亿': 1e8,
  'k': 1e3, 'K': 1e3, 'm': 1e6, 'M': 1e6,
  '千': 1e3, '百万': 1e6
};

// 支持的汇率对（用于处理非EUR基础的汇率对）
const SUPPORTED_PAIRS = {
  'USD/CNY': true, 'CNY/USD': true,
  'USD/JPY': true, 'JPY/USD': true,
  'EUR/USD': true, 'USD/EUR': true,
  'GBP/USD': true, 'USD/GBP': true,
  // 添加更多支持的汇率对
};

// 主入口
addEventListener('fetch', event => {
  event.respondWith(
    handleRequest(event.request).catch(err => {
      console.error('系统错误:', err);
      return formatResponse(`❌ 系统错误: ${err.message}\n\n💡 提示：如果查询非欧元汇率对，可能需要通过EUR中转计算`, 500);
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
    console.error('处理失败:', err);
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
  
  const match = input.match(/^([0-9,.]+)\s*([万千亿KMkm百万]+)?/);
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
  // 如果是非EUR基础的汇率对，尝试直接查询
  let result = await tryDirectConversion(from, to, amount);
  if (result) return result;
  
  // 如果直接查询失败，尝试通过EUR中转
  result = await tryEuroConversion(from, to, amount);
  if (result) return result;
  
  throw new Error('该货币对暂不支持或数据不可用');
}

async function tryDirectConversion(from, to, amount) {
  try {
    const apiUrl = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
    const response = await fetchWithTimeout(apiUrl, 5000);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const rate = data.rates[to];
    
    if (!rate) return null;
    
    const result = (amount * rate).toFixed(2);
    
    return formatResponse([
      `💱 ${formatLargeNumber(amount)} ${from} = ${formatCurrency(to, result)}`,
      `📊 1 ${from} = ${rate.toFixed(6)} ${to}`,
      `📅 汇率时间: ${data.date}`,
      `💡 需要历史数据请告诉我时间段（如"过去5年"）`
    ].join('\n'));
  } catch (error) {
    console.log(`直接转换失败 ${from}/${to}:`, error.message);
    return null;
  }
}

async function tryEuroConversion(from, to, amount) {
  try {
    // 通过EUR中转：from->EUR->to
    const fromToEurUrl = `https://api.frankfurter.app/latest?from=${from}&to=EUR`;
    const eurToToUrl = `https://api.frankfurter.app/latest?from=EUR&to=${to}`;
    
    const [fromToEurResp, eurToToResp] = await Promise.all([
      fetchWithTimeout(fromToEurUrl, 5000),
      fetchWithTimeout(eurToToUrl, 5000)
    ]);
    
    if (!fromToEurResp.ok || !eurToToResp.ok) return null;
    
    const fromToEurData = await fromToEurResp.json();
    const eurToToData = await eurToToResp.json();
    
    const fromToEurRate = fromToEurData.rates.EUR;
    const eurToToRate = eurToToData.rates[to];
    
    if (!fromToEurRate || !eurToToRate) return null;
    
    const finalRate = fromToEurRate * eurToToRate;
    const result = (amount * finalRate).toFixed(2);
    
    return formatResponse([
      `💱 ${formatLargeNumber(amount)} ${from} = ${formatCurrency(to, result)}`,
      `📊 1 ${from} = ${finalRate.toFixed(6)} ${to}`,
      `🔄 通过EUR中转计算: ${from}→EUR→${to}`,
      `📅 汇率时间: ${fromToEurData.date}`,
      `💡 需要历史数据请告诉我时间段（如"过去5年"）`
    ].join('\n'));
  } catch (error) {
    console.log(`EUR中转失败 ${from}/${to}:`, error.message);
    return null;
  }
}

// ================ 历史数据 ================
async function handleHistoricalData(from, to, timeRange) {
  const { startDate, endDate, description } = parseTimeRange(timeRange);
  
  // 尝试直接查询历史数据
  let result = await tryDirectHistoricalQuery(from, to, startDate, endDate, description);
  if (result && result.dataPoints >= 100) {
    return formatResponse(result.content);
  }
  
  // 如果直接查询数据不足，尝试EUR中转
  console.log(`直接查询数据不足(${result?.dataPoints || 0}点)，尝试EUR中转...`);
  result = await tryEuroHistoricalQuery(from, to, startDate, endDate, description);
  if (result) {
    return formatResponse(result.content);
  }
  
  // 如果都失败了，尝试更短的时间范围
  const fallbackResult = await tryFallbackTimeRange(from, to, endDate, description);
  return formatResponse(fallbackResult);
}

async function tryDirectHistoricalQuery(from, to, startDate, endDate, description) {
  try {
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);
    const apiUrl = `https://api.frankfurter.app/${startDateStr}..${endDateStr}?from=${from}&to=${to}`;
    
    console.log(`尝试直接查询: ${apiUrl}`);
    const response = await fetchWithTimeout(apiUrl, 10000);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const dataPoints = Object.keys(data.rates || {}).length;
    
    console.log(`直接查询结果: ${dataPoints} 个数据点`);
    
    if (dataPoints === 0) return null;
    
    const historyTable = generateHistoryTable(data, from, to, description);
    return {
      content: historyTable,
      dataPoints: dataPoints
    };
  } catch (error) {
    console.log(`直接历史查询失败: ${error.message}`);
    return null;
  }
}

async function tryEuroHistoricalQuery(from, to, startDate, endDate, description) {
  try {
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);
    
    // 获取from->EUR和EUR->to的历史数据
    const fromToEurUrl = `https://api.frankfurter.app/${startDateStr}..${endDateStr}?from=${from}&to=EUR`;
    const eurToToUrl = `https://api.frankfurter.app/${startDateStr}..${endDateStr}?from=EUR&to=${to}`;
    
    console.log(`尝试EUR中转查询: ${from}->EUR->${to}`);
    
    const [fromToEurResp, eurToToResp] = await Promise.all([
      fetchWithTimeout(fromToEurUrl, 10000),
      fetchWithTimeout(eurToToUrl, 10000)
    ]);
    
    if (!fromToEurResp.ok || !eurToToResp.ok) return null;
    
    const fromToEurData = await fromToEurResp.json();
    const eurToToData = await eurToToResp.json();
    
    // 合并计算汇率数据
    const combinedData = combineEuroData(fromToEurData, eurToToData, from, to);
    const dataPoints = Object.keys(combinedData.rates || {}).length;
    
    console.log(`EUR中转查询结果: ${dataPoints} 个数据点`);
    
    if (dataPoints === 0) return null;
    
    const historyTable = generateHistoryTable(combinedData, from, to, description + ' (通过EUR中转)');
    return {
      content: historyTable,
      dataPoints: dataPoints
    };
  } catch (error) {
    console.log(`EUR中转历史查询失败: ${error.message}`);
    return null;
  }
}

function combineEuroData(fromToEurData, eurToToData, from, to) {
  const combinedRates = {};
  const dates = Object.keys(fromToEurData.rates || {});
  
  dates.forEach(date => {
    const fromToEurRate = fromToEurData.rates[date]?.EUR;
    const eurToToRate = eurToToData.rates[date]?.[to];
    
    if (fromToEurRate && eurToToRate) {
      const finalRate = fromToEurRate * eurToToRate;
      if (!combinedRates[date]) combinedRates[date] = {};
      combinedRates[date][to] = finalRate;
    }
  });
  
  return {
    rates: combinedRates,
    start_date: fromToEurData.start_date,
    end_date: fromToEurData.end_date,
    base: from
  };
}

async function tryFallbackTimeRange(from, to, endDate, description) {
  // 尝试更短的时间范围
  const fallbackRanges = [
    { years: 5, desc: '过去5年' },
    { years: 3, desc: '过去3年' },
    { years: 1, desc: '过去1年' }
  ];
  
  for (const range of fallbackRanges) {
    try {
      const fallbackStart = new Date(endDate);
      fallbackStart.setFullYear(endDate.getFullYear() - range.years);
      
      const result = await tryDirectHistoricalQuery(from, to, fallbackStart, endDate, range.desc);
      if (result && result.dataPoints > 50) {
        return result.content + `\n\n⚠️ 原始${description}数据不可用，已显示${range.desc}数据`;
      }
    } catch (error) {
      console.log(`Fallback ${range.desc} 失败:`, error.message);
    }
  }
  
  return `❌ ${from}/${to} 历史数据暂不可用\n\n💡 建议尝试：\n• 更短的时间范围（如"过去1年"）\n• 主要货币对（如EUR/USD, USD/JPY）\n• 通过欧元中转的汇率计算`;
}

function parseTimeRange(input) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDate = now.getDate();
  
  const endDate = new Date(now);
  let startDate = new Date(now);
  let description = '近10年';

  const matches = input.match(/(过去|最近)?(\d+)(年|个月|月)/);
  if (matches) {
    const num = parseInt(matches[2]);
    const unit = matches[3];
    
    if (unit === '年') {
      const startYear = currentYear - num;
      startDate = new Date(startYear, currentMonth, currentDate);
      
      // 处理闰年边界情况
      if (currentMonth === 1 && currentDate === 29) {
        const isTargetLeap = (startYear % 4 === 0 && startYear % 100 !== 0) || startYear % 400 === 0;
        if (!isTargetLeap) {
          startDate.setDate(28);
        }
      }
      
      description = `过去${num}年`;
    } else {
      const targetMonth = currentMonth - num;
      if (targetMonth >= 0) {
        startDate = new Date(currentYear, targetMonth, currentDate);
      } else {
        const yearsBack = Math.ceil(Math.abs(targetMonth) / 12);
        const adjustedMonth = 12 + (targetMonth % 12);
        startDate = new Date(currentYear - yearsBack, adjustedMonth, currentDate);
      }
      
      if (startDate.getDate() !== currentDate) {
        startDate.setDate(0);
      }
      
      description = `过去${num}个月`;
    }
  } else {
    const startYear = currentYear - DEFAULT_HISTORY_YEARS;
    startDate = new Date(startYear, currentMonth, currentDate);
    
    if (currentMonth === 1 && currentDate === 29) {
      const isTargetLeap = (startYear % 4 === 0 && startYear % 100 !== 0) || startYear % 400 === 0;
      if (!isTargetLeap) {
        startDate.setDate(28);
      }
    }
    
    description = `过去${DEFAULT_HISTORY_YEARS}年`;
  }

  if (startDate > endDate) {
    startDate = new Date(endDate);
    startDate.setFullYear(endDate.getFullYear() - 1);
  }

  return { startDate, endDate, description };
}

function generateHistoryTable(data, from, to, description) {
  const yearlyStats = {};
  const allRates = [];
  
  if (!data.rates || Object.keys(data.rates).length === 0) {
    return `❌ 没有找到 ${from}/${to} 的历史数据`;
  }
  
  // 统计年度数据
  Object.entries(data.rates).forEach(([date, rates]) => {
    const year = date.substring(0, 4);
    const rate = rates[to];
    if (rate && !isNaN(rate)) {
      allRates.push(rate);
      
      if (!yearlyStats[year]) {
        yearlyStats[year] = { min: rate, max: rate, sum: rate, count: 1 };
      } else {
        yearlyStats[year].min = Math.min(yearlyStats[year].min, rate);
        yearlyStats[year].max = Math.max(yearlyStats[year].max, rate);
        yearlyStats[year].sum += rate;
        yearlyStats[year].count++;
      }
    }
  });

  if (allRates.length === 0) {
    return `❌ ${from}/${to} 汇率数据处理失败`;
  }

  // 生成年度统计表格
  let table = `\n📈 年度详细统计：\n\n`;
  
  const sortedYears = Object.keys(yearlyStats).sort();
  sortedYears.forEach(year => {
    const { min, max, sum, count } = yearlyStats[year];
    const avg = (sum / count);
    const volatility = ((max - min) / min * 100);
    
    table += `${year}年: 最低${min.toFixed(4)} | 最高${max.toFixed(4)} | 均值${avg.toFixed(4)} | 波动${volatility.toFixed(1)}%\n`;
  });

  // 整体统计
  const overallMin = Math.min(...allRates);
  const overallMax = Math.max(...allRates);
  const overallAvg = allRates.reduce((a, b) => a + b, 0) / allRates.length;
  const totalVolatility = ((overallMax - overallMin) / overallMin * 100);
  
  // 获取实际的数据日期范围
  const dates = Object.keys(data.rates).sort();
  const actualStartDate = dates[0];
  const actualEndDate = dates[dates.length - 1];
  
  // 找出最值对应的年份
  const minYear = sortedYears.find(year => yearlyStats[year].min === overallMin);
  const maxYear = sortedYears.find(year => yearlyStats[year].max === overallMax);

  return [
    `📊 ${from}/${to} ${description}汇率统计`,
    `📅 数据范围: ${formatDisplayDate(new Date(actualStartDate))} 至 ${formatDisplayDate(new Date(actualEndDate))}`,
    `📈 数据点数: ${allRates.length.toLocaleString()} 个交易日`,
    table,
    `\n📌 整体趋势分析`,
    `• 历史最低: ${overallMin.toFixed(4)} ${to} (${minYear}年)`,
    `• 历史最高: ${overallMax.toFixed(4)} ${to} (${maxYear}年)`,
    `• 期间平均: ${overallAvg.toFixed(4)} ${to}`,
    `• 总体波动: ${totalVolatility.toFixed(2)}%`,
    `• 数据年份: ${sortedYears[0]}-${sortedYears[sortedYears.length-1]} (${sortedYears.length}年)`,
    `• 最新数据: ${new Date(actualEndDate).toLocaleDateString('zh-CN')}`,
    ``,
    `💡 如需其他时间段分析或货币对比，请告诉我！`
  ].join('\n');
}

// ================ 辅助函数 ================
async function fetchWithTimeout(url, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Currency-Bot/1.0'
      }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function fetchWithCache(url, ttl) {
  try {
    const cache = caches.default;
    const cached = await cache.match(url);
    if (cached) return cached;

    const response = await fetchWithTimeout(url, 10000);
    if (!response.ok) return response;

    const responseToCache = response.clone();
    // 使用waitUntil确保缓存操作完成
    if (typeof event !== 'undefined') {
      event.waitUntil(
        cache.put(url, responseToCache, { expirationTtl: ttl })
      );
    }
    return response;
  } catch (error) {
    console.error('缓存操作失败:', error);
    return await fetchWithTimeout(url, 10000);
  }
}

function formatLargeNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

function formatCurrency(currency, value) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value).replace(/\s/g, '');
  } catch (error) {
    return `${currency} ${value}`;
  }
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDisplayDate(date) {
  const validDate = new Date(date);
  if (isNaN(validDate.getTime())) {
    return new Date().toLocaleDateString('zh-CN');
  }
  return validDate.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

function formatResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-cache'
    }
  });
}
