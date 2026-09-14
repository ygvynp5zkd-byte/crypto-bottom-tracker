const COINS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","LINKUSDT",
  "AVAXUSDT","SUIUSDT","LTCUSDT","DOGEUSDT","ADAUSDT","TRXUSDT",
  "DOTUSDT","SHIBUSDT","UNIUSDT","AAVEUSDT","NEARUSDT","ATOMUSDT",
  "FILUSDT","ARBUSDT","OPUSDT","INJUSDT","SEIUSDT","TIAUSDT"
];

const TAKE_PROFIT = 0.02;
const STOP_LOSS = 0.015;

const LOOKBACK_24 = 96;
const BOTTOM_ZONE = 20.0;
const MIN_DROP = 3.0;
const MAX_DROP = 30.0;

const BOTTOM_LOOKBACK = 20;
const BOTTOM_TOLERANCE = 1.0;
const MIN_BOTTOM_TESTS = 2;

const RSI_LENGTH = 14;
const RSI_MAX = 50;

const EMA_FAST_LENGTH = 20;
const VOLUME_LENGTH = 20;
const VOLUME_MULTIPLIER = 1.1;

const REQUIRED_SCORE = 5;


// ============================================================
// SMA
// ============================================================

function sma(values, length) {
  if (values.length < length) return null;

  let sum = 0;

  for (let i = values.length - length; i < values.length; i++) {
    sum += values[i];
  }

  return sum / length;
}


// ============================================================
// EMA
// ============================================================

function emaSeries(values, length) {
  const result = new Array(values.length).fill(null);

  if (values.length < length) return result;

  let sum = 0;

  for (let i = 0; i < length; i++) {
    sum += values[i];
  }

  result[length - 1] = sum / length;

  const multiplier = 2 / (length + 1);

  for (let i = length; i < values.length; i++) {
    result[i] =
      (values[i] - result[i - 1]) * multiplier +
      result[i - 1];
  }

  return result;
}


// ============================================================
// RSI
// ============================================================

function rsiSeries(values, length) {
  const result = new Array(values.length).fill(null);

  if (values.length <= length) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= length; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / length;
  let avgLoss = losses / length;

  result[length] =
    avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = length + 1; i < values.length; i++) {

    const change = values[i] - values[i - 1];

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain =
      (avgGain * (length - 1) + gain) / length;

    avgLoss =
      (avgLoss * (length - 1) + loss) / length;

    result[i] =
      avgLoss === 0
        ? 100
        : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}


// ============================================================
// LOWEST
// ============================================================

function lowest(values, length, endIndex) {

  const start =
    Math.max(0, endIndex - length + 1);

  let result = Infinity;

  for (let i = start; i <= endIndex; i++) {
    if (values[i] < result) {
      result = values[i];
    }
  }

  return result;
}


// ============================================================
// HIGHEST
// ============================================================

function highest(values, length, endIndex) {

  const start =
    Math.max(0, endIndex - length + 1);

  let result = -Infinity;

  for (let i = start; i <= endIndex; i++) {
    if (values[i] > result) {
      result = values[i];
    }
  }

  return result;
}


// ============================================================
// MACD
// ============================================================

function macdSeries(values) {

  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);

  const macd = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {

    if (
      fast[i] !== null &&
      slow[i] !== null
    ) {
      macd[i] = fast[i] - slow[i];
    }
  }

  const signal = new Array(values.length).fill(null);

  const validMacd = [];
  const validIndexes = [];

  for (let i = 0; i < macd.length; i++) {

    if (macd[i] !== null) {
      validMacd.push(macd[i]);
      validIndexes.push(i);
    }
  }

  if (validMacd.length >= 9) {

    const signalValues =
      emaSeries(validMacd, 9);

    for (let i = 0; i < signalValues.length; i++) {

      if (signalValues[i] !== null) {

        signal[validIndexes[i]] =
          signalValues[i];
      }
    }
  }

  const histogram =
    new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {

    if (
      macd[i] !== null &&
      signal[i] !== null
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
// V2.4 BUY SIGNAL
// ============================================================

function calculateBuySignal(candles) {

  const n = candles.length;

  if (n < 120) {
    return false;
  }

  const opens =
    candles.map(c => c.open);

  const highs =
    candles.map(c => c.high);

  const lows =
    candles.map(c => c.low);

  const closes =
    candles.map(c => c.close);

  const volumes =
    candles.map(c => c.volume);

  const i = n - 1;


  // ----------------------------------------------------------
  // 24H RANGE
  // ----------------------------------------------------------

  const lowest24 =
    lowest(lows, LOOKBACK_24, i);

  const highest24 =
    highest(highs, LOOKBACK_24, i);

  const range24 =
    highest24 - lowest24;

  const distanceFromLow =
    range24 > 0
      ? ((closes[i] - lowest24) / range24) * 100
      : 100;

  const nearBottom =
    distanceFromLow <= BOTTOM_ZONE;


  // ----------------------------------------------------------
  // 24H CHANGE
  // ----------------------------------------------------------

  const pastIndex =
    i - LOOKBACK_24;

  if (pastIndex < 0) {
    return false;
  }

  const pricePast =
    closes[pastIndex];

  const change24 =
    pricePast !== 0
      ? ((closes[i] - pricePast) / pricePast) * 100
      : 0;

  const strongDrop =
    change24 <= -MIN_DROP &&
    change24 >= -MAX_DROP;


  // ----------------------------------------------------------
  // RECENT BOTTOM
  // ----------------------------------------------------------

  const recentLow =
    lowest(
      lows,
      BOTTOM_LOOKBACK,
      i
    );

  const bottomReference =
    recentLow *
    (1 + BOTTOM_TOLERANCE / 100);

  const nearRecentBottom =
    lows[i] <= bottomReference;


  // ----------------------------------------------------------
  // BOTTOM TESTS
  // ----------------------------------------------------------

  let bottomTests = 0;

  const start =
    Math.max(
      0,
      i - BOTTOM_LOOKBACK + 1
    );

  for (let j = start; j <= i; j++) {

    const historicalRecentLow =
      lowest(
        lows,
        BOTTOM_LOOKBACK,
        j
      );

    const historicalReference =
      historicalRecentLow *
      (1 + BOTTOM_TOLERANCE / 100);

    if (
      lows[j] <= historicalReference
    ) {
      bottomTests++;
    }
  }

  const qualityBottom =
    bottomTests >= MIN_BOTTOM_TESTS;


  // ----------------------------------------------------------
  // BOTTOM REJECTION
  // ----------------------------------------------------------

  const candleRange =
    highs[i] - lows[i];

  const lowerWick =
    Math.min(
      opens[i],
      closes[i]
    ) - lows[i];

  const lowerWickPercent =
    candleRange > 0
      ? lowerWick / candleRange * 100
      : 0;

  const bottomRejection =
    candleRange > 0 &&
    lowerWickPercent >= 35 &&
    closes[i] >
      lows[i] + candleRange * 0.55;


  // ----------------------------------------------------------
  // SELLING PRESSURE
  // ----------------------------------------------------------

  const body =
    Math.abs(
      closes[i] - opens[i]
    );

  const bodyPrevious =
    Math.abs(
      closes[i - 1] - opens[i - 1]
    );

  const sellingPressureWeakening =
    closes[i] > closes[i - 1] &&
    body <= bodyPrevious * 1.5;


  // ----------------------------------------------------------
  // RSI
  // ----------------------------------------------------------

  const rsi =
    rsiSeries(
      closes,
      RSI_LENGTH
    );

  const currentRSI =
    rsi[i];

  const previousRSI =
    rsi[i - 2];

  const rsiRising =
    currentRSI !== null &&
    previousRSI !== null &&
    currentRSI > previousRSI;

  const rsiCondition =
    currentRSI !== null &&
    currentRSI <= RSI_MAX &&
    rsiRising;


  // ----------------------------------------------------------
  // EMA
  // ----------------------------------------------------------

  const emaFastValues =
    emaSeries(
      closes,
      EMA_FAST_LENGTH
    );

  const emaFast =
    emaFastValues[i];

  const emaFastPrevious =
    emaFastValues[i - 2];

  const emaRecovery =
    emaFast !== null &&
    closes[i] > emaFast;

  const emaTurningUp =
    emaFast !== null &&
    emaFastPrevious !== null &&
    emaFast > emaFastPrevious;


  // ----------------------------------------------------------
  // MACD
  // ----------------------------------------------------------

  const macd =
    macdSeries(closes);

  const macdLine =
    macd.macd[i];

  const previousMacdLine =
    macd.macd[i - 1];

  const histogram =
    macd.histogram[i];

  const previousHistogram =
    macd.histogram[i - 1];

  const macdImproving =
    histogram !== null &&
    previousHistogram !== null &&
    histogram > previousHistogram;

  const macdTurningUp =
    macdLine !== null &&
    previousMacdLine !== null &&
    macdLine > previousMacdLine;


  // ----------------------------------------------------------
  // VOLUME
  // ----------------------------------------------------------

  const avgVolume =
    sma(
      volumes,
      VOLUME_LENGTH
    );

  const volumeStrong =
    avgVolume !== null &&
    volumes[i] >
      avgVolume * VOLUME_MULTIPLIER;


  // ----------------------------------------------------------
  // BULLISH CANDLE
  // ----------------------------------------------------------

  const bullishCandle =
    closes[i] > opens[i];

  const strongClose =
    candleRange > 0 &&
    closes[i] >=
      lows[i] + candleRange * 0.60;

  const recoveryCandle =
    bullishCandle &&
    strongClose;


  // ----------------------------------------------------------
  // SCORE
  // ----------------------------------------------------------

  let score = 0;

  if (nearBottom)
    score += 2;

  if (strongDrop)
    score += 1;

  if (rsiCondition)
    score += 1;

  if (emaRecovery)
    score += 1;

  if (emaTurningUp)
    score += 1;

  if (
    macdImproving &&
    macdTurningUp
  )
    score += 1;

  if (
    volumeStrong &&
    recoveryCandle
  )
    score += 1;


  // ----------------------------------------------------------
  // SAFETY
  // ----------------------------------------------------------

  const lastDrop =
    closes[i] <
    closes[i - 1] * 0.985;

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
  // FINAL BUY
  // ----------------------------------------------------------

  return (
    score >= REQUIRED_SCORE &&
    bottomQualitySignal &&
    safeRecovery
  );
}


// ============================================================
// OKX PUBLIC MARKET DATA
// ============================================================

async function fetchMarketCandles(symbol) {

  // BTCUSDT -> BTC-USDT
  const base =
    symbol.replace("USDT", "");

  const instId =
    `${base}-USDT`;

  const url =
    `https://www.okx.com/api/v5/market/candles` +
    `?instId=${instId}` +
    `&bar=15m` +
    `&limit=130`;

  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "crypto-bottom-tracker"
      }
    });

  if (!response.ok) {

    throw new Error(
      `OKX ${symbol}: ${response.status}`
    );
  }

  const json =
    await response.json();

  if (
    json.code !== "0" ||
    !Array.isArray(json.data)
  ) {

    throw new Error(
      `OKX ${symbol}: invalid data`
    );
  }

  /*
    OKX candle format:

    [
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      volumeCurrency,
      volumeCurrencyQuote,
      confirm
    ]
  */

  const candles =
    json.data
      .reverse()
      .map(k => ({
        time: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        confirmed: k[8] === "1"
      }));


  // Keep only confirmed/closed candles
  const confirmed =
    candles.filter(
      c => c.confirmed
    );

  return confirmed;
}


// ============================================================
// D1 TABLE
// ============================================================

async function ensureTable(env) {

  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS trades (
        symbol TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 0,
        entry REAL,
        tp REAL,
        sl REAL,
        entry_time INTEGER
      )
    `)
    .run();
}


// ============================================================
// GET TRADE
// ============================================================

async function getTrade(
  env,
  symbol
) {

  return await env.DB
    .prepare(
      `SELECT * FROM trades WHERE symbol = ?`
    )
    .bind(symbol)
    .first();
}


// ============================================================
// SAVE TRADE
// ============================================================

async function saveTrade(
  env,
  symbol,
  active,
  entry,
  tp,
  sl,
  entryTime
) {

  await env.DB
    .prepare(`
      INSERT OR REPLACE INTO trades
      (symbol, active, entry, tp, sl, entry_time)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      symbol,
      active ? 1 : 0,
      entry,
      tp,
      sl,
      entryTime
    )
    .run();
}


// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(
  env,
  text
) {

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
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          chat_id: chatId,
          text
        })
      }
    );

  if (!response.ok) {

    const errorText =
      await response.text();

    throw new Error(
      `Telegram ${response.status}: ${errorText}`
    );
  }
}


// ============================================================
// PROCESS ONE COIN
// ============================================================

async function processCoin(
  env,
  symbol
) {

  try {

    const candles =
      await fetchMarketCandles(symbol);

    if (candles.length < 120) {

      throw new Error(
        `Not enough closed candles`
      );
    }

    const latest =
      candles[candles.length - 1];

    const trade =
      await getTrade(
        env,
        symbol
      );


    // ========================================================
    // EXISTING OPEN TRADE
    // ========================================================

    if (
      trade &&
      trade.active === 1
    ) {

      const price =
        latest.close;


      // SL
      if (
        price <= trade.sl
      ) {

        await saveTrade(
          env,
          symbol,
          false,
          null,
          null,
          null,
          null
        );

        return {
          symbol,
          status: "SL",
          price
        };
      }


      // TP
      if (
        price >= trade.tp
      ) {

        await saveTrade(
          env,
          symbol,
          false,
          null,
          null,
          null,
          null
        );

        return {
          symbol,
          status: "TP",
          price
        };
      }


      // Still OPEN
      return {
        symbol,
        status: "OPEN",
        entry: trade.entry,
        tp: trade.tp,
        sl: trade.sl,
        price
      };
    }


    // ========================================================
    // WAIT / NEW BUY
    // ========================================================

    const buySignal =
      calculateBuySignal(
        candles
      );


    if (!buySignal) {

      return {
        symbol,
        status: "WAIT",
        price: latest.close
      };
    }


    // ========================================================
    // NEW BUY
    // ========================================================

    const entry =
      latest.close;

    const tp =
      entry * (1 + TAKE_PROFIT);

    const sl =
      entry * (1 - STOP_LOSS);


    await saveTrade(
      env,
      symbol,
      true,
      entry,
      tp,
      sl,
      latest.time
    );


    const message =
      `🟢 NEW BUY\n\n` +
      `Coin: ${symbol}\n` +
      `Entry: ${entry}\n` +
      `TP: ${tp}\n` +
      `SL: ${sl}\n\n` +
      `Strategy: 24H Bottom Recovery V2.4\n` +
      `Timeframe: 15m\n` +
      `Data: OKX`;


    await sendTelegram(
      env,
      message
    );


    return {
      symbol,
      status: "NEW BUY",
