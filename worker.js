const COINS = [
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

export default {

  async fetch(request, env) {

    try {

      await initDatabase(env);

      const url = new URL(request.url);

      if (url.pathname === "/") {

        return json({
          ok: true,
          service: "24H Bottom Recovery V2.4",
          source: "OKX",
          timeframe: "15m",
          coins: COINS.length
        });

      }

      if (url.pathname === "/run") {

        const results = [];

        for (const symbol of COINS) {

          try {

            const candles =
              await getCandles(symbol);

            results.push({
              symbol: symbol,
              status: "OK",
              candles: candles.length,
              price: candles.length
                ? candles[candles.length - 1].close
                : null
            });

          } catch (error) {

            results.push({
              symbol: symbol,
              status: "ERROR",
              error: error.message
            });

          }

        }

        return json({
          ok: true,
          source: "OKX",
          timeframe: "15m",
          checked: COINS.length,
          results: results
        });
      }

      return new Response("Not Found", {
        status: 404
      });

    } catch (error) {

      return json({
        ok: false,
        error: error.message
      }, 500);

    }
  },


  async scheduled(event, env, ctx) {

    ctx.waitUntil(
      testRun(env)
    );

  }

};


// ============================================================
// DATABASE
// ============================================================

async function initDatabase(env) {

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS trades (
      symbol TEXT PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 0,
      entry REAL,
      tp REAL,
      sl REAL,
      entry_time INTEGER
    )
  `).run();

}


// ============================================================
// OKX
// ============================================================

async function getCandles(symbol) {

  const base =
    symbol.replace("USDT", "");

  const instId =
    base + "-USDT";

  const url =
    "https://www.okx.com/api/v5/market/candles" +
    "?instId=" +
    encodeURIComponent(instId) +
    "&bar=15m" +
    "&limit=130";

  const response =
    await fetch(url);

  if (!response.ok) {

    throw new Error(
      "OKX HTTP " + response.status
    );

  }

  const data =
    await response.json();

  if (data.code !== "0") {

    throw new Error(
      "OKX: " +
      (data.msg || "API error")
    );

  }

  if (!Array.isArray(data.data)) {

    throw new Error(
      "Invalid OKX candle data"
    );

  }

  const rows =
    [...data.data].reverse();

  const candles = [];

  for (const row of rows) {

    if (!Array.isArray(row)) {
      continue;
    }

    if (row.length < 9) {
      continue;
    }

    const confirmed =
      String(row[8]) === "1";

    if (!confirmed) {
      continue;
    }

    candles.push({

      timestamp: Number(row[0]),

      open: Number(row[1]),

      high: Number(row[2]),

      low: Number(row[3]),

      close: Number(row[4]),

      volume: Number(row[5])

    });

  }

  return candles;

}


// ============================================================
// TEST RUN
// ============================================================

async function testRun(env) {

  try {

    await initDatabase(env);

    const symbol = "BTCUSDT";

    const candles =
      await getCandles(symbol);

    console.log(
      "OKX TEST",
      symbol,
      candles.length
    );

  } catch (error) {

    console.log(
      "TEST ERROR",
      error.message
    );

  }

}


// ============================================================
// JSON
// ============================================================

function json(data, status = 200) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status: status,
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );

}
