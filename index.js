// index.js - Cloudflare Worker 汇率转换API
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from')?.toUpperCase() || 'USD';
    const to = searchParams.get('to')?.toUpperCase() || 'CNY';
    const amount = parseFloat(searchParams.get('amount')) || 1;

    // 验证货币代码
    if (from.length !== 3 || to.length !== 3) {
      return jsonResponse({ error: "Invalid currency code" }, 400);
    }

    // 调用免费汇率API
    const apiUrl = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      return jsonResponse({ error: "Failed to fetch exchange rate" }, 502);
    }

    const data = await response.json();
    const rate = data.rates[to];
    const result = (amount * rate).toFixed(4);

    // 返回结果
    return jsonResponse({
      from,
      to,
      amount,
      rate: parseFloat(rate.toFixed(6)),
      result: parseFloat(result),
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// 辅助函数：返回JSON响应
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
