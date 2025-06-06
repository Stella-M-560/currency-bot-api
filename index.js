// index.js - Cloudflare Worker
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
  
  // 构建API URL - 使用正确的日期格式
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  const apiUrl = `https://api.frankfurter.app/${startDateStr}..${endDateStr}?from=${from}&to=${to}`;
  
  const response = await fetchWithCache(apiUrl, 3600); // 缓存1小时
  
  if (!response.ok) throw new Error('历史汇率API不可用');
  
  const data = await response.json();
  const historyTable = generateHistoryTable(data, from, to, description);
  
  return formatResponse(historyTable);
}

function parseTimeRange(input) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11
  const currentDate = now.getDate();
  
  // 创建结束日期（今天）
  const endDate = new Date(now);
  
  // 创建开始日期
  let startDate = new Date(now);
  let description = '近10年';

  const matches = input.match(/(过去|最近)?(\d+)(年|个月|月)/);
  if (matches) {
    const num = parseInt(matches[2]);
    const unit = matches[3];
    
    if (unit === '年') {
      // 计算开始年份：当前年份 - 指定年数
      const startYear = currentYear - num;
      startDate = new Date(startYear, currentMonth, currentDate);
      
      // 处理闰年边界情况：如果当前是2月29日，但目标年份不是闰年
      if (currentMonth === 1 && currentDate === 29) {
        const isTargetLeap = (startYear % 4 === 0 && startYear % 100 !== 0) || startYear % 400 === 0;
        if (!isTargetLeap) {
          startDate.setDate(28); // 改为2月28日
        }
      }
      
      description = `过去${num}年`;
    } else {
      // 处理月份：当前月份 - 指定月数
      const targetMonth = currentMonth - num;
      if (targetMonth >= 0) {
        startDate = new Date(currentYear, targetMonth, currentDate);
      } else {
        // 跨年计算
        const yearsBack = Math.ceil(Math.abs(targetMonth) / 12);
        const adjustedMonth = 12 + (targetMonth % 12);
        startDate = new Date(currentYear - yearsBack, adjustedMonth, currentDate);
      }
      
      // 处理月末日期边界情况（如1月31日往前推1个月应该是12月31日而不是12月31日不存在的情况）
      if (startDate.getDate() !== currentDate) {
        startDate.setDate(0); // 设置为上个月的最后一天
      }
      
      description = `过去${num}个月`;
    }
  } else {
    // 默认处理：过去10年
    const startYear = currentYear - DEFAULT_HISTORY_YEARS;
    startDate = new Date(startYear, currentMonth, currentDate);
    
    // 处理闰年边界情况
    if (currentMonth === 1 && currentDate === 29) {
      const isTargetLeap = (startYear % 4 === 0 && startYear % 100 !== 0) || startYear % 400 === 0;
      if (!isTargetLeap) {
        startDate.setDate(28);
      }
    }
    
    description = `过去${DEFAULT_HISTORY_YEARS}年`;
  }

  // 确保开始日期不晚于结束日期
  if (startDate > endDate) {
    startDate = new Date(endDate);
    startDate.setFullYear(endDate.getFullYear() - 1); // 至少1年的数据
  }

  return { 
    startDate, 
    endDate, 
    description,
    // 添加调试信息（可选）
    debug: {
      input,
      startYear: startDate.getFullYear(),
      endYear: endDate.getFullYear(),
      currentYear
    }
  };
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
      const avg = (sum / count).toFixed(4);
      const volatility = ((max - min) / min * 100).toFixed(2);
      table += `| ${year} | ${min.toFixed(4)} | ${max.toFixed(4)} | ${avg} | ${volatility}% |\n`;
    });

  // 整体统计
  const overallMin = Math.min(...allRates).toFixed(4);
  const overallMax = Math.max(...allRates).toFixed(4);
  const overallAvg = (allRates.reduce((a, b) => a + b, 0) / allRates.length).toFixed(4);
  
  // 获取实际的数据日期范围
  const dates = Object.keys(data.rates).sort();
  const actualStartDate = dates[0];
  const actualEndDate = dates[dates.length - 1];

  return [
    `📊 **${from}/${to} ${description}汇率统计**`,
    `📅 数据范围: ${formatDisplayDate(new Date(actualStartDate))} 至 ${formatDisplayDate(new Date(actualEndDate))}`,
    `📈 数据点数: ${allRates.length} 个交易日`,
    '',
    table,
    '',
    `📌 整体趋势`,
    `- 历史最低: ${overallMin} ${to}`,
    `- 历史最高: ${overallMax} ${to}`,
    `- 期间平均: ${overallAvg} ${to}`,
    `- 总体波动: ${(((Math.max(...allRates) - Math.min(...allRates)) / Math.min(...allRates)) * 100).toFixed(2)}%`,
    `- 数据更新: ${actualEndDate}`
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
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
