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

const BATCH_SIZE = 3;
const DELAY_BETWEEN_BATCHES = 1500;
const MAX_RETRIES = 3;


// ============================================================
// WORKER
// ============================================================

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

        for (
          let start = 0;
          start < COINS.length;
          start += BATCH_SIZE
        ) {

          const batch =
            COINS.slice(
              start,
              start + BATCH_SIZE
            );

          const batchResults =
            await Promise.all(
              batch.map(
                symbol => checkCoin(symbol)
              )
            );

          results.push(...batchResults);

          if (
            start + BATCH_SIZE <
            COINS.length
          ) {

            await sleep(
              DELAY_BETWEEN_BATCHES
            );

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

      return new Response(
        "Not Found",
        { status: 404 }
      );

    } catch (error) {

      return json({
        ok: false,
        error: error.message
      }, 500);

    }

  },


  async scheduled(event, env, ctx) {

    ctx.waitUntil(
      scheduledRun(env)
    );

  }

};


// ============================================================
// CHECK ONE COIN
// ============================================================

async function checkCoin(symbol) {

  try {

    const candles =
      await getCandlesWithRetry(symbol);

    return {

      symbol: symbol,

      status: "OK",

      candles: candles.length,

      price:
        candles.length > 0
          ? candles[candles.length - 1].close
          : null

    };

  } catch (error) {

    return {

      symbol: symbol,

      status: "ERROR",

      error: error.message

    };

  }

}


// ============================================================
// OKX REQUEST WITH RETRY
// ============================================================

async function getCandlesWithRetry(symbol) {

  let lastError =
    "Unknown error";

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    try {

      return await getCandles(symbol);

    } catch (error) {

      lastError =
        error.message;

      if (
        !lastError.includes("429")
      ) {

        throw error;

      }

      if (
        attempt < MAX_RETRIES
      ) {

        const waitTime =
          2000 * attempt;

        await sleep(waitTime);

      }

    }

  }

  throw new Error(
    lastError
  );

}


// ============================================================
// GET OKX CANDLES
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
    await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

  if (!response.ok) {

    throw new Error(
      "OKX HTTP " +
      response.status
    );

  }

  const data =
    await response.json();

  if (
    !data ||
    data.code !== "0"
  ) {

    throw new Error(
      "OKX: " +
      (
        data &&
        data.msg
          ? data.msg
          : "API error"
      )
    );

  }

  if (
    !Array.isArray(data.data)
  ) {

    throw new Error(
      "Invalid OKX candle data"
    );

  }

  const rows =
    [...data.data].reverse();

  const candles = [];

  for (const row of rows) {

    if (
      !Array.isArray(row) ||
      row.length < 9
    ) {
      continue;
    }

    /*
      OKX:
      row[8] = confirmation
      1 = closed
      0 = still forming
    */

    if (
      String(row[8]) !== "1"
    ) {
      continue;
    }

    const candle = {

      timestamp:
        Number(row[0]),

      open:
        Number(row[1]),

      high:
        Number(row[2]),

      low:
        Number(row[3]),

      close:
        Number(row[4]),

      volume:
        Number(row[5])

    };

    if (
      !Number.isFinite(
        candle.close
      )
    ) {
      continue;
    }

    candles.push(candle);

  }

  return candles;

}


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
// SCHEDULED TEST
// ============================================================

async function scheduledRun(env) {

  try {

    await initDatabase(env);

    console.log(
      "Scheduled OKX test started"
    );

  } catch (error) {

    console.log(
      "Scheduled error:",
      error.message
    );

  }

}


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {

  return new Promise(
    resolve => setTimeout(
      resolve,
      ms
    )
  );

}


function json(
  data,
  status = 200
) {

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
