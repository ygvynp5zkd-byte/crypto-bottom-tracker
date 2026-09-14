const COINS = [
  "BTC", "ETH", "BNB", "SOL", "XRP", "LINK",
  "AVAX", "SUI", "LTC", "DOGE", "ADA", "TRX",
  "DOT", "SHIB", "UNI", "AAVE", "NEAR", "ATOM",
  "FIL", "ARB", "OP", "INJ", "SEI", "TIA"
];

const CANDLE_COUNT = 130;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // الصفحة الرئيسية
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "Coinbase 15m Test",
        coins: COINS.length,
        candles_required: CANDLE_COUNT
      });
    }

    // اختبار العملات
    if (url.pathname === "/run") {
      const results = [];

      for (const coin of COINS) {
        const result = await testCoin(coin);
        results.push(result);

        // تأخير صغير لتجنب rate limit
        await sleep(250);
      }

      const working = results.filter(x => x.status === "OK");
      const failed = results.filter(x => x.status !== "OK");

      return json({
        ok: true,
        source: "Coinbase Exchange",
        timeframe: "15m",
        total: COINS.length,
        working: working.length,
        failed: failed.length,
        results
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};


async function testCoin(coin) {

  const product = `${coin}-USD`;

  // آخر 32.5 ساعة تقريباً
  // 130 × 15 دقيقة = 1950 دقيقة
  const end = Math.floor(Date.now() / 1000);
  const start = end - (CANDLE_COUNT * 15 * 60);

  const endpoint =
    `https://api.exchange.coinbase.com/products/${product}/candles` +
    `?granularity=900` +
    `&start=${start}` +
    `&end=${end}`;

  try {

    const response = await fetch(endpoint, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      return {
        coin,
        product,
        status: "ERROR",
        http: response.status,
        candles: 0,
        message: `HTTP ${response.status}`
      };
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return {
        coin,
        product,
        status: "ERROR",
        http: 200,
        candles: 0,
        message: "No candle data"
      };
    }

    // Coinbase يعيد:
    // [time, low, high, open, close, volume]

    const candles = data
      .map(c => ({
        time: Number(c[0]),
        low: Number(c[1]),
        high: Number(c[2]),
        open: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      }))
      .sort((a, b) => a.time - b.time);

    const last = candles[candles.length - 1];

    return {
      coin,
      product,
      status: "OK",
      http: 200,
      candles: candles.length,
      last_close: last.close,
      last_candle: new Date(last.time * 1000).toISOString()
    };

  } catch (error) {

    return {
      coin,
      product,
      status: "ERROR",
      http: 0,
      candles: 0,
      message: error.message
    };
  }
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function json(data) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
