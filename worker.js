const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "SUIUSDT",
  "LTCUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "TRXUSDT",
  "DOTUSDT",
  "SHIBUSDT",
  "UNIUSDT",
  "AAVEUSDT",
  "NEARUSDT",
  "ATOMUSDT",
  "FILUSDT",
  "ARBUSDT",
  "OPUSDT",
  "INJUSDT",
  "SEIUSDT",
  "TIAUSDT"
];

const CANDLES_REQUIRED = 130;

export default {
  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    // الصفحة الرئيسية
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "Bybit 24 Coins Test",
        market: "Spot",
        timeframe: "15m",
        coins: SYMBOLS.length,
        candles_required: CANDLES_REQUIRED
      });
    }

    // اختبار العملات الـ24
    if (url.pathname === "/run") {
      return await testAllCoins();
    }

    return new Response("Not Found", {
      status: 404
    });
  }
};


async function testAllCoins() {

  const results = [];

  for (const symbol of SYMBOLS) {

    const result = await testSymbol(symbol);

    results.push(result);

    // تأخير بسيط بين الطلبات
    await sleep(150);
  }

  const successful = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  return json({

    ok: failed.length === 0,

    source: "Bybit",

    market: "Spot",

    timeframe: "15m",

    total_coins: SYMBOLS.length,

    successful: successful.length,

    failed: failed.length,

    results: results

  });
}


async function testSymbol(symbol) {

  const endpoint =
    "https://api.bybit.com/v5/market/kline" +
    "?category=spot" +
    "&symbol=" + encodeURIComponent(symbol) +
    "&interval=15" +
    "&limit=" + CANDLES_REQUIRED;

  try {

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {

      return {
        ok: false,
        symbol: symbol,
        http: response.status,
        error: text
      };

    }

    let data;

    try {

      data = JSON.parse(text);

    } catch (error) {

      return {
        ok: false,
        symbol: symbol,
        error: "Invalid JSON response",
        raw: text
      };

    }

    // فحص Bybit retCode
    if (data.retCode !== 0) {

      return {
        ok: false,
        symbol: symbol,
        retCode: data.retCode,
        retMsg: data.retMsg
      };

    }

    const list = data?.result?.list || [];

    if (list.length === 0) {

      return {
        ok: false,
        symbol: symbol,
        error: "No candle data"
      };

    }

    // تحويل بيانات Bybit إلى شكل واضح
    const candles = list
      .map(c => ({

        time: Number(c[0]),

        open: Number(c[1]),

        high: Number(c[2]),

        low: Number(c[3]),

        close: Number(c[4]),

        volume: Number(c[5])

      }))
      .sort((a, b) => a.time - b.time);


    const last = candles[candles.length - 1];


    return {

      ok: true,

      symbol: symbol,

      candles: candles.length,

      last_close: last.close,

      last_candle: new Date(last.time).toISOString()

    };


  } catch (error) {

    return {

      ok: false,

      symbol: symbol,

      error: error.message

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
