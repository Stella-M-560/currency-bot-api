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
  
  if (!response.ok) {
    // 如果长时间范围失败，尝试较短的时间范围
    if (endDate.getFullYear() - startDate.getFullYear() > 5) {
      const fallbackStart = new Date(endDate);
      fallbackStart.setFullYear(endDate.getFullYear() - 5);
      const fallbackUrl = `https://api.frankfurter.app/${formatDate(fallbackStart)}..${endDateStr}?from=${from}&to=${to}`;
      const fallbackResponse = await fetchWithCache(fallbackUrl, 3600);
      
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        const historyTable = generateHistoryTable(fallbackData, from, to, '过去5年(数据受限)');
        return formatResponse(historyTable + '\n\n⚠️ 完整历史数据暂不可用，已显示过去5年数据');
      }
    }
    
    throw new Error(`历史汇率API不可用 (${response.status})`);
  }
  
  const data = await response.json();
  
  // 添加调试信息（仅在开发模式下）
  const debugInfo = {
    requestedRange: `${startDateStr} to ${endDateStr}`,
    actualRange: data.start_date + ' to ' + data.end_date,
    dataPoints: Object.keys(data.rates || {}).length,
    currencies: Object.keys(data.rates?.[Object.keys(data.rates)[0]] || {})
  };
  
  // 验证数据质量
  if (!data.rates || Object.keys(data.rates).length < 50) {
    return formatResponse(`⚠️ ${from}/${to} 历史数据量较少 (${Object.keys(data.rates || {}).length}个交易日)，可能影响统计准确性\n\n` + 
                         generateHistoryTable(data, from, to, description));
  }
  
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
  
  // 检查数据结构
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

  // 生成年度统计表格 - 使用更清晰的格式
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
  // 确保使用正确的日期格式
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
      'Access-Control-Allow-Origin': '*'
    }
  });
}
