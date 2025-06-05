// index.js - 优化版汇率转换API (Cloudflare Worker)
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // 解析请求参数
  const { searchParams } = new URL(request.url)
  const from = (searchParams.get('from') || 'USD').toUpperCase()
  const to = (searchParams.get('to') || 'CNY').toUpperCase()
  const amount = Math.abs(parseFloat(searchParams.get('amount')) || 1)

  // 验证货币代码 (ISO 4217标准)
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return formatResponse('❌ 货币代码必须是3位大写字母（如USD/CNY）', 400)
  }

  try {
    // 检查缓存
    const cacheKey = `${from}_${to}_${amount}`
    const cachedResponse = await caches.default.match(cacheKey)
    if (cachedResponse) return cachedResponse

    // 调用汇率API（支持失败自动重试）
    const apiResponse = await fetchWithRetry(
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      3 // 最大重试次数
    )

    if (!apiResponse.ok) {
      throw new Error(`API响应失败: ${apiResponse.status}`)
    }

    const data = await apiResponse.json()
    const rate = data.rates[to]
    const result = (amount * rate).toFixed(2)

    // 构建响应
    const responseText = [
      `💱 ${amount} ${from} = ${formatCurrency(to, result)}`,
      `📊 汇率: 1 ${from} = ${rate.toFixed(6)} ${to}`,
      `🕒 更新时间: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`
    ].join('\n')

    const response = formatResponse(responseText)

    // 缓存结果（5分钟）
    event.waitUntil(
      caches.default.put(
        cacheKey,
        response.clone(),
        { expirationTtl: 300 } // 5分钟缓存
      )
    )

    return response

  } catch (error) {
    // 备用数据源（当主API失败时）
    const fallbackResponse = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`
    )
    
    if (fallbackResponse.ok) {
      const fallbackData = await fallbackResponse.json()
      const rate = fallbackData[from.toLowerCase()][to.toLowerCase()]
      const result = (amount * rate).toFixed(2)
      
      return formatResponse(
        `⚠️ 实时汇率暂不可用，使用备用数据:\n` +
        `💱 ${amount} ${from} = ${formatCurrency(to, result)}\n` +
        `📌 注: 此数据可能延迟24小时`
      )
    }

    return formatResponse(
      '❌ 汇率服务暂时不可用，请稍后重试或访问 [XE Currency](https://www.xe.com/)',
      503
    )
  }
}

// 辅助函数：带重试的fetch
async function fetchWithRetry(url, maxRetries) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)))
  }
  return new Response(null, { status: 502 })
}

// 辅助函数：格式化货币显示
function formatCurrency(currency, value) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  return formatter.format(value).replace(/\s/g, '') // 移除空格（如"CN¥100"替代"CN¥ 100"）
}

// 辅助函数：标准化响应
function formatResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  })
}
