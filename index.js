// index.js - 完整版汇率API (支持动态时间范围)
const DEFAULT_HISTORY_YEARS = 10; // 默认查询10年

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
  
  // 解析请求类型
  const isHistoryRequest = pathname.startsWith('/history');
  let { from, to, amount, timeRange, error } = parseParams(searchParams);
  if (error) return formatResponse(error, 400);

  try {
    if (isHistoryRequest) {
      return handleHistoricalData(from, to, timeRange);
    } else {
      return handleRealTimeConversion(from, to, amount);
    }
  } catch (err) {
    return formatResponse(`❌ 处理失败: ${err.message}`, 500);
  }
}

// ================== 参数解析 ==================
function parseParams(params) {
  let from = params.get('from');
  let to = params.get('to');
  const amount = parseInputAmount(params.get('amount'));
  const timeRange = params.get('range') || params.get('time') || '10年'; // 默认10年

  // 货币代码转换
  from = normalizeCurrency(from);
  to = normalizeCurrency(to);
  
  // 验证
  if (!from || !to) return { error: '❌ 无法识别货币对' };
  if (isNaN(amount)) return { error: '❌ 金额格式无效' };

  return { from, to, amount, timeRange };
}

// ================== 历史数据处理 ==================
async function handleHistoricalData(from, to, timeRange) {
  // 计算日期范围
  const { startDate, endDate, description } = parseTimeRange(timeRange);
  
  const apiUrl = `https://api.frankfurter.app/${formatDate(startDate)}..${formatDate(endDate)}?from=${from}&to=${to}`;
  const response = await fetchWithCache(apiUrl, 86400); // 缓存1天
  
  if (!response.ok) throw new Error('历史数据API不可用');
  
  const data = await response.json();
  return formatResponse(
    generateHistoryTable(data, from, to, description)
  );
}

// 解析时间范围
function parseTimeRange(input) {
  const now = new Date();
  const start = new Date(now);
  let description = '';

  // 解析中文时间段
  const matches = input.match(/(过去|最近)?(\d+)(年|个月|月|天)/);
  if (matches) {
    const num = parseInt(matches[2]);
    const unit = matches[3];
    
    switch(unit) {
      case '年':
        start.setFullYear(now.getFullYear() - num);
        description = `过去${num}年`;
        break;
      case '个月': case '月':
        start.setMonth(now.getMonth() - num);
        description = `过去${num}个月`;
        break;
      case '天':
        start.setDate(now.getDate() - num);
        description = `过去${num}天`;
        break;
    }
  } else {
    // 默认返回10年
    start.setFullYear(now.getFullYear() - DEFAULT_HISTORY_YEARS);
    description = `近${DEFAULT_HISTORY_YEARS}年`;
  }

  return { 
    startDate: start, 
    endDate: now,
    description 
  };
}

// 生成历史数据表格
function generateHistoryTable(data, from, to, description) {
  const yearlyStats = {};
  const allRates = [];
  
  // 按年统计
  Object.entries(data.rates).forEach(([date, rates]) => {
    const year = date.substring(0, 4);
    const rate = rates[to];
    allRates.push(rate);
    
    if (!yearlyStats[year]) {
      yearlyStats[year] = {
        min: rate,
        max: rate,
        sum: rate,
        count: 1,
        dates: [date]
      };
    } else {
      yearlyStats[year].min = Math.min(yearlyStats[year].min, rate);
      yearlyStats[year].max = Math.max(yearlyStats[year].max, rate);
      yearlyStats[year].sum += rate;
      yearlyStats[year].count++;
      yearlyStats[year].dates.push(date);
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
  const overallAvg = (allRates.reduce((a, b) => a + b, 0) / allRates.length.toFixed(4);
  const lastDate = yearlyStats[Object.keys(yearlyStats).pop()].dates.pop();

  return [
    `📊 **${from}/${to} ${description}汇率统计**`,
    `📅 数据范围: ${formatDisplayDate(new Date(data.start_date))} 至 ${formatDisplayDate(new Date(data.end_date))}`,
    '',
    table,
    '',
    `📌 **整体趋势**`,
    `- 历史最低: ${overallMin} ${to}`,
    `- 历史最高: ${overallMax} ${to}`,
    `- 期间平均: ${overallAvg} ${to}`,
    `- 更新日期: ${lastDate}`
  ].join('\n');
}

// ================== 辅助函数 ==================
// （保持之前的 formatCurrency, fetchWithCache 等函数不变）
// ...

// 日期显示格式化
function formatDisplayDate(date) {
  return date.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}
