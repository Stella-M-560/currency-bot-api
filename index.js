// index.js - 终极版汇率API (2025-06-20更新)
const HISTORY_YEARS = 10;

// 货币别名库 (支持中英文/口语)
const CURRENCY_ALIAS = {
  // 主流货币
  'USD': 'USD', '美金': 'USD', '美元': 'USD', '刀': 'USD',
  'CNY': 'CNY', '人民币': 'CNY', 'rmb': 'CNY', '软妹币': 'CNY',
  'JPY': 'JPY', '日元': 'JPY', '倭元': 'JPY', 
  'EUR': 'EUR', '欧元': 'EUR', '欧': 'EUR',
  'GBP': 'GBP', '英镑': 'GBP', '镑': 'GBP',
  
  // 其他常见货币
  'KRW': 'KRW', '韩元': 'KRW', '韩币': 'KRW',
  'CAD': 'CAD', '加元': 'CAD', 
  'AUD': 'AUD', '澳元': 'AUD'
};

// 单位换算系数
const UNIT_MAP = {
  '万': 1e4, 'w': 1e4, 'W': 1e4,
  '亿': 1e8, 
  'k': 1e3, 'K': 1e3, '千': 1e3,
  'm': 1e6, 'M': 1e6, '百万': 1e6
};

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
  
  // 解析动作类型 (历史or实时)
  const action = pathname.startsWith('/history') ? 'history' : 'convert';
  
  // 获取并验证参数
  let { from, to, amount, error } = parseParams(searchParams);
  if (error) return formatResponse(error, 400);

  try {
    if (action === 'convert') {
      return handleRealTimeConversion(from, to, amount);
    } else {
      return handleHistoricalData(from, to);
    }
  } catch (err) {
    return formatResponse(`❌ 处理失败: ${err.message}`, 500);
  }
}

// ================== 参数解析核心 ==================
function parseParams(params) {
  // 优先尝试从URL参数获取
  let from = params.get('from');
  let to = params.get('to');
  let amount = parseInputAmount(params.get('amount'));
  
  // 备用：从路径解析 (如 /USD/CNY/100)
  if ((!from || !to) && pathParts.length > 2) {
    [, from, to, amountStr] = pathParts;
    amount = parseInputAmount(amountStr) || amount;
  }

  // 货币代码转换
  from = normalizeCurrency(from);
  to = normalizeCurrency(to);
  
  // 验证
  if (!from || !to) {
    return { error: '❌ 无法识别货币对' };
  }
  if (isNaN(amount)) {
    return { error: '❌ 金额格式无效' };
  }

  return { from, to, amount };
}

// 智能金额解析 (支持1.2万/3K等)
function parseInputAmount(input) {
  if (!input) return 1;
  
  // 提取数字和单位
  const match = input.match(/^([0-9,.]+)\s*([万千亿KMkmtT万]+)?/);
  if (!match) return NaN;
  
  let num = parseFloat(match[1].replace(/,/g, ''));
  const unit = match[2];
  
  // 单位换算
  if (unit && UNIT_MAP[unit]) {
    num *= UNIT_MAP[unit];
  }
  
  return num;
}

// 货币别名转换
function normalizeCurrency(input) {
  if (!input) return null;
  
  // 去除多余字符
  const cleaned = input.toString()
    .replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '')
    .toUpperCase();
  
  // 检查直接匹配
  if (CURRENCY_ALIAS[cleaned]) {
    return CURRENCY_ALIAS[cleaned];
  }
  
  // 检查中文别名
  for (const [key, value] of Object.entries(CURRENCY_ALIAS)) {
    if (key.includes(cleaned) || cleaned.includes(key)) {
      return value;
    }
  }
  
  return null;
}

// ================== 实时汇率处理 ==================
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
    `💡 需要查看${HISTORY_YEARS}年历史数据请告诉我~`
  ].join('\n'));
}

// ================== 历史数据处理 ==================
async function handleHistoricalData(from, to) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - HISTORY_YEARS);
  
  const apiUrl = `https://api.frankfurter.app/${formatDate(startDate)}..${formatDate(endDate)}?from=${from}&to=${to}`;
  const response = await fetchWithCache(apiUrl, 86400); // 缓存1天
  
  if (!response.ok) throw new Error('历史数据API不可用');
  
  const data = await response.json();
  return formatResponse(generateHistoryTable(data, from, to, startDate, endDate));
}

// ================== 辅助函数 ==================
// 生成历史数据表格 (Markdown格式)
function generateHistoryTable(data, from, to, startDate, endDate) {
  const yearlyStats = {};
  const allRates = [];
  
  // 计算年度统计
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
      const fluctuation = ((max - min) / min * 100).toFixed(2) + '%';
      table += `| ${year} | ${min.toFixed(4)} | ${max.toFixed(4)} | ${avg} | ${fluctuation} |\n`;
    });

  // 整体统计
  const overallMin = Math.min(...allRates).toFixed(4);
  const overallMax = Math.max(...allRates).toFixed(4);
  const overallAvg = (allRates.reduce((a, b) => a + b, 0) / allRates.length).toFixed(4);
  const lastDate = Object.keys(data.rates).pop();

  return [
    `📊 **${from}/${to} 近${HISTORY_YEARS}年统计**`,
    `📅 数据范围: ${formatDisplayDate(startDate)} 至 ${formatDisplayDate(endDate)}`,
    '',
    table,
    '',
    `📌 **关键指标**`,
    `- 历史最低: ${overallMin} ${to}`,
    `- 历史最高: ${overallMax} ${to}`,
    `- ${HISTORY_YEARS}年平均: ${overallAvg} ${to}`,
    `- 数据更新: ${lastDate}`
  ].join('\n');
}

// 带缓存的fetch
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

// 数字格式化
function formatLargeNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
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

// 日期格式化
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDisplayDate(date) {
  return date.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

// 响应包装
function formatResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
