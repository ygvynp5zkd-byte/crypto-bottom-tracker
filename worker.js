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

const TP_PERCENT = 2.0;
const SL_PERCENT = 1.5;

const LOOKBACK_24 = 96;
const BOTTOM_ZONE = 20.0;
const MIN_DROP = 3.0;
const MAX_DROP = 30.0;

const BOTTOM_LOOKBACK = 20;
const BOTTOM_TOLERANCE = 1.0;
const MIN_BOTTOM_TESTS = 2;

const RSI_LENGTH = 14;
const RSI_MAX = 50.0;

const EMA_FAST_LENGTH = 20;
const EMA_SLOW_LENGTH = 50;

const VOLUME_LENGTH = 20;
const VOLUME_MULTIPLIER = 1.1;

const REQUIRED_SCORE = 5;


// ============================================================
// CLOUDFLARE WORKER
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
        const result = await runTracker(env);

        return json(result);
      }

      return new Response("Not Found", { status: 404 });

    } catch (error) {
      return json({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTracker(env));
  }
};


// ============================================================
// MAIN TRACKER
// ============================================================

async function runTracker(env) {

  await initDatabase(env);

  const results = [];

  for (const symbol of COINS) {

    try {

      const candles = await getOKXCandles(symbol);

      if (!candles || candles.length < 100) {
        results.push({
          symbol,
          status: "ERROR",
          error: "Not enough candle data"
        });

        continue;
      }

      const analysis = analyzeV24(candles);

      const result = await updateTrade(
        env,
        symbol,
        analysis,
        candles
      );

      results.push({
        symbol,
        ...analysis.summary,
        ...result
      });

    } catch (error) {

      results.push({
        symbol,
        status: "ERROR",
        error: error instanceof Error
          ? error.message
          : String(error)
      });

    }
  }

  return {
    ok: true,
    checked: COINS.length,
    source: "OKX",
    timeframe: "15m",
    timestamp: Date.now(),
    results
  };
}


// ============================================================
// OKX DATA
// ============================================================

async function getOKXCandles(symbol) {

  const base = symbol.replace("USDT", "");

  const instId = `${base}-USDT`;

  const url =
    `https://www.okx.com/api/v5/market/candles` +
    `?instId=${encodeURIComponent(instId)}` +
    `&bar=15m` +
    `&limit=130`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`OKX ${symbol}: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data || data.code !== "0") {
    throw new Error(
      `OKX ${symbol}: ${data?.msg || "API error"}`
    );
  }

  if (!Array.isArray(data.data)) {
    throw new Error(`OKX ${symbol}: invalid candle data`);
  }

  /*
    OKX candles are returned newest -> oldest.

    We reverse them so:
    index 0 = oldest
    last index = newest
  */

  const rows = [...data.data].reverse();

  const candles = [];

  for (const row of rows) {

    if (!Array.isArray(row) || row.length < 9) {
      continue;
    }

    const timestamp = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);

    /*
      OKX row[8]:
      1 = confirmed/closed candle
      0 = still forming
    */

    const confirmed = String(row[8]) === "1";

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }

    if (!confirmed) {
      continue;
    }

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume
    });
  }

  return candles;
}


// ============================================================
// V2.4 ANALYSIS
// ============================================================

function analyzeV24(candles) {

  const n = candles.length;

  if (n < 100) {
    throw new Error("Insufficient candles");
  }

  const i = n - 1;

  const close = candles[i].close;
  const open = candles[i].open;
  const high = candles[i].high;
  const low = candles[i].low;

  // ----------------------------------------------------------
  // 24H RANGE
  // ----------------------------------------------------------

  const start24 = Math.max(0, i - LOOKBACK_24 + 1);

  let lowest24 = Infinity;
  let highest24 = -Infinity;

  for (let j = start24; j <= i; j++) {

    if (candles[j].low < lowest24) {
      lowest24 = candles[j].low;
    }

    if (candles[j].high > highest24) {
      highest24 = candles[j].high;
    }
  }

  const range24 = highest24 - lowest24;

  const distanceFromLow =
    range24 > 0
      ? ((close - lowest24) / range24) * 100
      : 100;

  const nearBottom =
    distanceFromLow <= BOTTOM_ZONE;


  // ----------------------------------------------------------
  // 24H CHANGE
  // ----------------------------------------------------------

  const pastIndex = i - LOOKBACK_24;

  const pricePast =
    pastIndex >= 0
      ? candles[pastIndex].close
      : null;

  const change24 =
    pricePast !== null && pricePast !== 0
      ? ((close - pricePast) / pricePast) * 100
      : 0;

  const strongDrop =
    change24 <= -MIN_DROP &&
    change24 >= -MAX_DROP;


  // ----------------------------------------------------------
  // RECENT BOTTOM
  // ----------------------------------------------------------

  const bottomStart =
    Math.max(0, i - BOTTOM_LOOKBACK + 1);

  let recentLow = Infinity;

  for (let j = bottomStart; j <= i; j++) {

    if (candles[j].low < recentLow) {
      recentLow = candles[j].low;
    }
  }

  const bottomReference =
    recentLow * (1 + BOTTOM_TOLERANCE / 100);

  let bottomTests = 0;

  for (let j = bottomStart; j <= i; j++) {

    if (candles[j].low <= bottomReference) {
      bottomTests++;
    }
  }

  const qualityBottom =
    bottomTests >= MIN_BOTTOM_TESTS;

  const nearRecentBottom =
    low <= recentLow * (1 + BOTTOM_TOLERANCE / 100);


  // ----------------------------------------------------------
  // BOTTOM REJECTION
  // ----------------------------------------------------------

  const candleRange = high - low;

  const lowerWick =
    Math.min(open, close) - low;

  const lowerWickPercent =
    candleRange > 0
      ? (lowerWick / candleRange) * 100
      : 0;

  const bottomRejection =
    candleRange > 0 &&
    lowerWickPercent >= 35 &&
    close > low + candleRange * 0.55;


  // ----------------------------------------------------------
  // SELLING PRESSURE
  // ----------------------------------------------------------

  const previous = candles[i - 1];

  const body =
    Math.abs(close - open);

  const bodyPrevious =
    Math.abs(previous.close - previous.open);

  const sellingPressureWeakening =
    close > previous.close &&
    body <= bodyPrevious * 1.5;


  // ----------------------------------------------------------
  // RSI
  // ----------------------------------------------------------

  const rsiValues = calculateRSI(
    candles,
    RSI_LENGTH
  );

  const rsi = rsiValues[i];

  const rsiTwoBarsAgo =
    i >= 2
      ? rsiValues[i - 2]
      : null;

  const rsiRising =
    Number.isFinite(rsi) &&
    Number.isFinite(rsiTwoBarsAgo) &&
    rsi > rsiTwoBarsAgo;

  const rsiCondition =
    Number.isFinite(rsi) &&
    rsi <= RSI_MAX &&
    rsiRising;


  // ----------------------------------------------------------
  // EMA
  // ----------------------------------------------------------

  const emaFastValues =
    calculateEMA(
      candles,
      EMA_FAST_LENGTH
    );

  const emaSlowValues =
    calculateEMA(
      candles,
      EMA_SLOW_LENGTH
    );

  const emaFast = emaFastValues[i];
  const emaSlow = emaSlowValues[i];

  const emaFastTwoBarsAgo =
    i >= 2
      ? emaFastValues[i - 2]
      : null;

  const emaRecovery =
    Number.isFinite(emaFast) &&
    close > emaFast;

  const emaTurningUp =
    Number.isFinite(emaFast) &&
    Number.isFinite(emaFastTwoBarsAgo) &&
    emaFast > emaFastTwoBarsAgo;


  // ----------------------------------------------------------
  // MACD
  // ----------------------------------------------------------

  const macd =
    calculateMACD(candles);

  const macdHist =
    macd.histogram[i];

  const macdHistPrevious =
    i >= 1
      ? macd.histogram[i - 1]
      : null;

  const macdLine =
    macd.macd[i];

  const macdLinePrevious =
    i >= 1
      ? macd.macd[i - 1]
      : null;

  const macdImproving =
    Number.isFinite(macdHist) &&
    Number.isFinite(macdHistPrevious) &&
    macdHist > macdHistPrevious;

  const macdTurningUp =
    Number.isFinite(macdLine) &&
    Number.isFinite(macdLinePrevious) &&
    macdLine > macdLinePrevious;


  // ----------------------------------------------------------
  // VOLUME
  // ----------------------------------------------------------

  const avgVolume =
    simpleAverageVolume(
      candles,
      i,
      VOLUME_LENGTH
    );

  const volumeStrong =
    Number.isFinite(avgVolume) &&
    volume > avgVolume * VOLUME_MULTIPLIER;


  // ----------------------------------------------------------
  // BULLISH CANDLE
  // ----------------------------------------------------------

  const bullishCandle =
    close > open;

  const strongClose =
    candleRange > 0 &&
    close >= low + candleRange * 0.60;

  const recoveryCandle =
    bullishCandle &&
    strongClose;


  // ----------------------------------------------------------
  // SCORE
  // ----------------------------------------------------------

  let score = 0;

  if (nearBottom) {
    score += 2;
  }

  if (strongDrop) {
    score += 1;
  }

  if (rsiCondition) {
    score += 1;
  }

  if (emaRecovery) {
    score += 1;
  }

  if (emaTurningUp) {
    score += 1;
  }

  if (macdImproving && macdTurningUp) {
    score += 1;
  }

  if (volumeStrong && recoveryCandle) {
    score += 1;
  }


  // ----------------------------------------------------------
  // SAFETY
  // ----------------------------------------------------------

  const lastDrop =
    close < previous.close * 0.985;

  const safeRecovery =
    !lastDrop;


  // ----------------------------------------------------------
  // BOTTOM QUALITY
  // ----------------------------------------------------------

  const bottomQualitySignal =
    qualityBottom &&
    nearRecentBottom &&
    bottomRejection &&
    sellingPressureWeakening;


  // ----------------------------------------------------------
  // BUY
  // ----------------------------------------------------------

  const buySignal =
    score >= REQUIRED_SCORE &&
    bottomQualitySignal &&
    safeRecovery;


  return {

    buySignal,

    summary: {
      score,
      change24: round(change24, 2),
      distanceFromLow: round(distanceFromLow, 2),
      rsi: round(rsi, 2),
      bottomTests,
      close: round(close, 8)
    }
  };
}


// ============================================================
// TRADE STATE
// ============================================================

async function updateTrade(
  env,
  symbol,
  analysis,
  candles
) {

  const state =
    await getTrade(env, symbol);

  const currentPrice =
    candles[candles.length - 1].close;


  // ==========================================================
  // ACTIVE TRADE
  // ==========================================================

  if (state && state.active === 1) {

    const entry = Number(state.entry);
    const tp = Number(state.tp);
    const sl = Number(state.sl);

    /*
      IMPORTANT:
      We check TP/SL regardless of whether
      the current V2.4 BUY signal still exists.
    */

    if (currentPrice >= tp) {

      await closeTrade(env, symbol);

      return {
        status: "CLOSED TP",
        entry: round(entry, 8),
        exit: round(currentPrice, 8),
        result: `+${TP_PERCENT}%`
      };
    }


    if (currentPrice <= sl) {

      await closeTrade(env, symbol);

      return {
        status: "CLOSED SL",
        entry: round(entry, 8),
        exit: round(currentPrice, 8),
        result: `-${SL_PERCENT}%`
      };
    }


    return {
      status: "OPEN",
      entry: round(entry, 8),
      tp: round(tp, 8),
      sl: round(sl, 8),
      current: round(currentPrice, 8)
    };
  }


  // ==========================================================
  // NEW BUY
  // ==========================================================

  if (analysis.buySignal) {

    const entry = currentPrice;

    const tp =
      entry * (1 + TP_PERCENT / 100);

    const sl =
      entry * (1 - SL_PERCENT / 100);

    await openTrade(
      env,
      symbol,
      entry,
      tp,
      sl,
      Date.now()
    );


    // Telegram ONLY HERE
    await sendTelegram(
      env,
      formatBuyMessage(
        symbol,
        entry,
        tp,
        sl,
        analysis
      )
    );


    return {
      status: "NEW BUY",
      entry: round(entry, 8),
      tp: round(tp, 8),
      sl: round(sl, 8)
    };
  }


  return {
    status: "WAIT"
  };
}


// ============================================================
// D1 DATABASE
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


async function getTrade(env, symbol) {

  return await env.DB
    .prepare(`
      SELECT *
      FROM trades
      WHERE symbol = ?
    `)
    .bind(symbol)
    .first();
}


async function openTrade(
  env,
  symbol,
  entry,
  tp,
  sl,
  entryTime
) {

  await env.DB
    .prepare(`
      INSERT INTO trades
        (symbol, active, entry, tp, sl, entry_time)
      VALUES
        (?, 1, ?, ?, ?, ?)

      ON CONFLICT(symbol)
      DO UPDATE SET
        active = 1,
        entry = excluded.entry,
        tp = excluded.tp,
        sl = excluded.sl,
        entry_time = excluded.entry_time
    `)
    .bind(
      symbol,
      entry,
      tp,
      sl,
      entryTime
    )
    .run();
}


async function closeTrade(env, symbol) {

  await env.DB
    .prepare(`
      UPDATE trades
      SET
        active = 0,
        entry = NULL,
        tp = NULL,
        sl = NULL,
        entry_time = NULL
      WHERE symbol = ?
    `)
    .bind(symbol)
    .run();
}


// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(env, message) {

  const token =
    env.TELEGRAM_BOT_TOKEN;

  const chatId =
    env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "Telegram secrets are missing"
    );
  }

  const url =
    `https://api.telegram.org/bot${token}/sendMessage`;

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    });

  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      `Telegram HTTP ${response.status}: ${text}`
    );
  }

  const result =
    await response.json();

  if (!result.ok) {
    throw new Error(
      `Telegram error: ${result.description || "Unknown error"}`
    );
  }
}


// ============================================================
// TELEGRAM MESSAGE
// ============================================================

function formatBuyMessage(
  symbol,
  entry,
  tp,
  sl,
  analysis
) {

  const coin =
    symbol.replace("USDT", "");

  return (
    `🟢 NEW BUY\n\n` +
    `💰 ${coin}/USDT\n` +
    `⏱ 15m\n\n` +
    `📌 Entry: ${formatPrice(entry)}\n` +
    `🎯 TP: ${formatPrice(tp)} (+${TP_PERCENT}%)\n` +
    `🛑 SL: ${formatPrice(sl)} (-${SL_PERCENT}%)\n\n` +
    `⭐ Score: ${analysis.summary.score}/8\n` +
    `📉 24H: ${analysis.summary.change24}%\n` +
    `📍 From Bottom: ${analysis.summary.distanceFromLow}%\n` +
    `📊 RSI: ${analysis.summary.rsi}\n` +
    `🔄 Bottom Tests: ${analysis.summary.bottomTests}\n\n` +
    `Source: OKX`
  );
}


// ============================================================
// RSI
// ============================================================

function calculateRSI(candles, length) {

  const result =
    new Array(candles.length).fill(NaN);

  if (candles.length <= length) {
    return result;
  }

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= length; i++) {

    const change =
      candles[i].close -
      candles[i - 1].close;

    if (change > 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  let avgGain =
    gainSum / length;

  let avgLoss =
    lossSum / length;

  if (avgLoss === 0) {
    result[length] = 100;
  } else {

    const rs =
      avgGain / avgLoss;

    result[length] =
      100 - (100 / (1 + rs));
  }


  for (let i = length + 1; i < candles.length; i++) {

    const change =
      candles[i].close -
      candles[i - 1].close;

    const gain =
      Math.max(change, 0);

    const loss =
      Math.max(-change, 0);

    avgGain =
      ((avgGain * (length - 1)) + gain) /
      length;

    avgLoss =
      ((avgLoss * (length - 1)) + loss) /
      length;

    if (avgLoss === 0) {

      result[i] = 100;

    } else {

      const rs =
        avgGain / avgLoss;

      result[i] =
        100 - (100 / (1 + rs));
    }
  }

  return result;
}


// ============================================================
// EMA
// ============================================================

function calculateEMA(candles, length) {

  const result =
    new Array(candles.length).fill(NaN);

  if (candles.length < length) {
    return result;
  }

  let sum = 0;

  for (let i = 0; i < length; i++) {
    sum += candles[i].close;
  }

  let ema =
    sum / length;

  result[length - 1] = ema;

  const multiplier =
    2 / (length + 1);

  for (let i = length; i < candles.length; i++) {

    ema =
      (candles[i].close - ema) *
      multiplier +
      ema;

    result[i] = ema;
  }

  return result;
}


// ============================================================
// MACD
// ============================================================

function calculateMACD(candles) {

  const ema12 =
    calculateEMA(candles, 12);

  const ema26 =
    calculateEMA(candles, 26);

  const macd =
    new Array(candles.length).fill(NaN);

  for (let i = 0; i < candles.length; i++) {

    if (
      Number.isFinite(ema12[i]) &&
      Number.isFinite(ema26[i])
    ) {
      macd[i] =
        ema12[i] - ema26[i];
    }
  }


  const signal =
    new Array(candles.length).fill(NaN);

  const histogram =
    new Array(candles.length).fill(NaN);

  const validMacd = [];

  for (let i = 0; i < macd.length; i++) {

    if (Number.isFinite(macd[i])) {
      validMacd.push({
        index: i,
        value: macd[i]
      });
    }
  }


  if (validMacd.length >= 9) {

    let sum = 0;

    for (let j = 0; j < 9; j++) {
      sum += validMacd[j].value;
    }

    let sig =
      sum / 9;

    signal[validMacd[8].index] =
      sig;

    const multiplier =
      2 / (9 + 1);

    for (let j = 9; j < validMacd.length; j++) {

      sig =
        (validMacd[j].value - sig) *
        multiplier +
        sig;

      signal[validMacd[j].index] =
        sig;
    }
  }


  for (let i = 0; i < candles.length; i++) {

    if (
      Number.isFinite(macd[i]) &&
      Number.isFinite(signal[i])
    ) {
      histogram[i] =
        macd[i] - signal[i];
    }
  }


  return {
    macd,
    signal,
    histogram
  };
}


// ============================================================
// VOLUME AVERAGE
// ============================================================

function simpleAverageVolume(
  candles,
  index,
  length
) {

  const start =
    Math.max(0, index - length + 1);

  let sum = 0;
  let count = 0;

  for (let i = start; i <= index; i++) {

    sum += candles[i].volume;
    count++;
  }

  return count > 0
    ? sum / count
    : NaN;
}


// ============================================================
// HELPERS
// ============================================================

function round(value, decimals = 2) {

  if (!Number.isFinite(value)) {
    return null;
  }

  const factor =
    Math.pow(10, decimals);

  return Math.round(
    value * factor
  ) / factor;
}


function formatPrice(value) {

  if (!Number.isFinite(value)) {
    return "N/A";
  }

  if (value >= 1000) {
    return value.toFixed(2);
  }

  if (value >= 1) {
    return value.toFixed(4);
  }

  if (value >= 0.01) {
    return value.toFixed(5);
  }

  return value.toFixed(8);
}


function json(data, status = 200) {

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}
