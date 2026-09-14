const SYMBOL = "BTCUSDT";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "Bybit 15m Test",
        symbol: SYMBOL,
        timeframe: "15m"
      });
    }
    if (url.pathname === "/run") {
      return await testBTC();
    }
    return new Response("Not Found", { status: 404 });
  }
};
async function testBTC() {
  const endpoint =
    "https://api.bybit.com/v5/market/kline" +
    "?category=spot" +
    "&symbol=BTCUSDT" +
    "&interval=15" +
    "&limit=130";
  try {
    const response = await fetch(endpoint, {
      headers: {
        "Accept": "application/json"
      }
    });
    const text = await response.text();
    if (!response.ok) {
      return json({
        ok: false,
        source: "Bybit",
        http: response.status,
        error: text
      });
    }
    const data = JSON.parse(text);
    if (data.retCode !== 0) {
      return json({
        ok: false,
        source: "Bybit",
        retCode: data.retCode,
        retMsg: data.retMsg
      });
    }
    const list = data?.result?.list || [];
    if (list.length === 0) {
      return json({
        ok: false,
        source: "Bybit",
        error: "No candle data"
      });
    }
    // Bybit يرجع البيانات من الأحدث إلى الأقدم
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
    return json({
      ok: true,
      source: "Bybit",
      market: "Spot",
      symbol: SYMBOL,
      timeframe: "15m",
      candles: candles.length,
      last_close: last.close,
      last_candle: new Date(last.time).toISOString()
    });
  } catch (error) {
    return json({
      ok: false,
      source: "Bybit",
      error: error.message
    });
  }
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
