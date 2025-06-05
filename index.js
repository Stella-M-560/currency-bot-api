// 替换原来的 generateHistoryChart 函数
function generateHistoryTable(data, from, to) {
  // 按年计算统计指标
  const yearlyStats = {};
  Object.entries(data.rates).forEach(([date, rates]) => {
    const year = date.substring(0, 4);
    const rate = rates[to];
    
    if (!yearlyStats[year]) {
      yearlyStats[year] = {
        min: rate,
        max: rate,
        sum: rate,
        count: 1
      };
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

  // 计算整体统计
  const allRates = Object.values(data.rates).map(r => r[to]);
  const overallMin = Math.min(...allRates).toFixed(4);
  const overallMax = Math.max(...allRates).toFixed(4);
  const overallAvg = (allRates.reduce((a, b) => a + b, 0) / allRates.length).toFixed(4);

  return [
    `📊 **${from}/${to} 近${HISTORY_YEARS}年汇率统计**`,
    `📅 数据范围: ${Object.keys(yearlyStats)[0]} 至 ${Object.keys(yearlyStats).pop()}`,
    '',
    table,
    '',
    `📌 **整体统计**`,
    `- 历史最低: ${overallMin} ${to}`,
    `- 历史最高: ${overallMax} ${to}`,
    `- 十年平均: ${overallAvg} ${to}`
  ].join('\n');
}

// 修改 handleHistoricalData 函数
async function handleHistoricalData(params) {
  // ...（前面的验证逻辑保持不变）

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - HISTORY_YEARS);

    const apiUrl = `https://api.frankfurter.app/${formatDate(startDate)}..${formatDate(endDate)}?from=${from}&to=${to}`;
    const historyData = await fetchWithCache(apiUrl, data => data);

    return formatResponse(
      generateHistoryTable(historyData, from, to)
    );

  } catch (error) {
    return formatResponse('❌ 历史数据获取失败: ' + error.message, 502);
  }
}
