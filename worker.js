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

// ==============================
// V2.4 SETTINGS
// ==============================

const LOOKBACK_24 = 96;
const BOTTOM_ZONE = 0.20;

const MIN_DROP = 0.03;
const MAX_DROP = 0.30;

const BOTTOM_LOOKBACK = 20;
const BOTTOM_TOLERANCE = 0.01;
const MIN_BOTTOM_TESTS = 2;

const RSI_LENGTH = 14;
const RSI_MAX = 50;

const EMA_FAST = 20;
const EMA_SLOW = 50;

const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

const VOLUME_LENGTH = 20;
const VOLUME_MULTIPLIER = 1.10;

const SCORE_REQUIRED = 5;


// ==============================
// WORKER
// ==============================

export default {

  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    if (url.pathname === "/") {

      return json({
        ok: true,
        service: "V2.4 Bybit Crypto Scanner",
        market: "Spot",
        timeframe: "15m",
        coins: SYMBOLS.length,
        candles_required: CANDLES_REQUIRED,
        score_required: SCORE_REQUIRED,
        tp: "2%",
        sl: "1.5%"
      });

    }

    if (url.pathname === "/scan") {

      return await scanAllCoins();

    }

    return new Response("Not Found", {
      status: 404
    });

  }

};


// ==============================
// SCAN ALL 24 COINS
// ==============================

async function scanAllCoins() {

  const results = [];

  for (const symbol of SYMBOLS) {

    const result = await scanSymbol(symbol);

    results.push(result);

    // Small delay
    await sleep(150);

  }

  const buySignals = results.filter(r => r.buy);

  return json({

    ok: true,

    source: "Bybit",

    market: "Spot",

    timeframe: "15m",

    total_coins: SYMBOLS.length,

    buy_count: buySignals.length,

    buy_symbols: buySignals.map(r => r.symbol),

    results: results

  });

}


// ==============================
// SCAN ONE SYMBOL
// ==============================

async function scanSymbol(symbol) {

  try {

    const candles = await getCandles(symbol);

    if (!candles || candles.length < CANDLES_REQUIRED) {

      return {
        ok: false,
        symbol,
        buy: false,
        error: "Insufficient candle data",
        candles: candles ? candles.length : 0
      };

    }

    const signal = calculateV24(candles);

    return {

      ok: true,

      symbol,

      buy: signal.buy,

      score: signal.score,

      score_required: SCORE_REQUIRED,

      bottom_quality: signal.bottomQuality,

      safe_recovery: signal.safeRecovery,

      rsi: round(signal.rsi),

      ema20: round(signal.ema20),

      ema50: round(signal.ema50),

      macd: round(signal.macd),

      macd_signal: round(signal.macdSignal),

      volume_ratio: round(signal.volumeRatio),

      close: signal.close,

      last_candle: new Date(
        signal.time
      ).toISOString(),

      reasons: signal.reasons

    };

  } catch (error) {

    return {

      ok: false,

      symbol,

      buy: false,

      error: error.message

    };

  }

}


// ==============================
// GET BYBIT CANDLES
// ==============================

async function getCandles(symbol) {

  const endpoint =
    "https://api.bybit.com/v5/market/kline" +
    "?category=spot" +
    "&symbol=" + encodeURIComponent(symbol) +
    "&interval=15" +
    "&limit=" + CANDLES_REQUIRED;

  const response = await fetch(endpoint, {

    method: "GET",

    headers: {
      "Accept": "application/json"
    }

  });

  const text = await response.text();

  if (!response.ok) {

    throw new Error(
      "Bybit HTTP " +
      response.status +
      ": " +
      text
    );

  }

  const data = JSON.parse(text);

  if (data.retCode !== 0) {

    throw new Error(
      "Bybit " +
      data.retCode +
      ": " +
      data.retMsg
    );

  }

  const list =
    data?.result?.list || [];

  return list

    .map(c => ({

      time: Number(c[0]),

      open: Number(c[1]),

      high: Number(c[2]),

      low: Number(c[3]),

      close: Number(c[4]),

      volume: Number(c[5])

    }))

    .sort(
      (a, b) => a.time - b.time
    );

}


// ==============================
// V2.4 LOGIC
// ==============================

function calculateV24(c) {

  const i = c.length - 1;

  const current = c[i];

  const close = current.close;

  const previous = c[i - 1];

  const reasons = [];

  let score = 0;


  // --------------------------------
  // 1. 24H RANGE / DROP
  // --------------------------------

  const recent = c.slice(
    Math.max(0, i - LOOKBACK_24 + 1),
    i + 1
  );

  const highest24 = Math.max(
    ...recent.map(x => x.high)
  );

  const lowest24 = Math.min(
    ...recent.map(x => x.low)
  );

  const dropFromHigh =
    (highest24 - close) / highest24;

  const recoveryFromLow =
    (close - lowest24) / lowest24;


  // Price must have experienced a meaningful drop
  const dropCondition =
    dropFromHigh >= MIN_DROP &&
    dropFromHigh <= MAX_DROP;


  // --------------------------------
  // 2. BOTTOM ZONE
  // --------------------------------

  const range24 =
    highest24 - lowest24;

  const bottomZonePrice =
    lowest24 +
    range24 * BOTTOM_ZONE;

  const inBottomZone =
    close <= bottomZonePrice;


  // --------------------------------
  // 3. RECENT BOTTOM TESTS
  // --------------------------------

  const bottomWindow = c.slice(
    Math.max(0, i - BOTTOM_LOOKBACK + 1),
    i + 1
  );

  const recentBottom =
    Math.min(
      ...bottomWindow.map(x => x.low)
    );

  let bottomTests = 0;

  for (const candle of bottomWindow) {

    const distance =
      Math.abs(candle.low - recentBottom)
      / recentBottom;

    if (distance <= BOTTOM_TOLERANCE) {
      bottomTests++;
    }

  }

  const enoughBottomTests =
    bottomTests >= MIN_BOTTOM_TESTS;


  // --------------------------------
  // 4. RSI
  // --------------------------------

  const rsi = calculateRSI(
    c,
    RSI_LENGTH
  );

  const previousRSI = calculateRSI(
    c.slice(0, -1),
    RSI_LENGTH
  );

  const rsiCondition =
    rsi <= RSI_MAX &&
    rsi > previousRSI;

  if (rsiCondition) {

    score++;

    reasons.push("RSI recovery");

  }


  // --------------------------------
  // 5. EMA 20 / 50
  // --------------------------------

  const closes =
    c.map(x => x.close);

  const ema20 =
    calculateEMA(
      closes,
      EMA_FAST
    );

  const ema50 =
    calculateEMA(
      closes,
      EMA_SLOW
    );

  const previousEMA20 =
    calculateEMA(
      closes.slice(0, -1),
      EMA_FAST
    );

  const emaCondition =
    close > ema20 &&
    ema20 > ema50 &&
    ema20 > previousEMA20;

  if (emaCondition) {

    score++;

    reasons.push("EMA trend");

  }


  // --------------------------------
  // 6. MACD
  // --------------------------------

  const macdData =
    calculateMACD(
      closes,
      MACD_FAST,
      MACD_SLOW,
      MACD_SIGNAL
    );

  const previousMACD =
    calculateMACD(
      closes.slice(0, -1),
      MACD_FAST,
      MACD_SLOW,
      MACD_SIGNAL
    );

  const macdImproving =
    macdData.macd >
    previousMACD.macd;

  const macdTurningUp =
    macdData.signal >
    previousMACD.signal;

  const macdCondition =
    macdImproving &&
    macdTurningUp;

  if (macdCondition) {

    score++;

    reasons.push("MACD improving");

  }


  // --------------------------------
  // 7. VOLUME + BULLISH CANDLE
  // --------------------------------

  const volumeValues =
    c.slice(
      Math.max(0, i - VOLUME_LENGTH),
      i
    ).map(x => x.volume);

  const averageVolume =
    average(volumeValues);

  const volumeRatio =
    current.volume /
    averageVolume;

  const bullishCandle =
    current.close >
    current.open;

  const volumeCondition =
    volumeRatio >= VOLUME_MULTIPLIER &&
    bullishCandle;

  if (volumeCondition) {

    score++;

    reasons.push(
      "Volume + bullish candle"
    );

  }


  // --------------------------------
  // 8. PRICE RECOVERY
  // --------------------------------

  const recoveryCondition =
    close >
    previous.close;

  if (recoveryCondition) {

    score++;

    reasons.push(
      "Price recovery"
    );

  }


  // --------------------------------
  // 9. BOTTOM QUALITY
  // --------------------------------

  const candleRange =
    current.high -
    current.low;

  const lowerWick =
    Math.min(
      current.open,
      current.close
    ) -
    current.low;

  const lowerWickRatio =
    candleRange > 0
      ? lowerWick / candleRange
      : 0;

  const closePosition =
    candleRange > 0
      ? (current.close - current.low)
        / candleRange
      : 0;


  const lowerWickGood =
    lowerWickRatio >= 0.35;

  const closePositionGood =
    closePosition >= 0.55;


  // Selling pressure weakening
  const previousRange =
    previous.high -
    previous.low;

  const previousBody =
    Math.abs(
      previous.close -
      previous.open
    );

  const currentBody =
    Math.abs(
      current.close -
      current.open
    );

  const sellingPressureWeakening =
    current.close >= previous.close ||
    currentBody < previousBody;


  const nearRecentBottom =
    Math.abs(
      close - recentBottom
    ) / recentBottom
    <= BOTTOM_TOLERANCE * 2;


  const bottomQuality =
    enoughBottomTests &&
    nearRecentBottom &&
    lowerWickGood &&
    closePositionGood &&
    sellingPressureWeakening;


  // --------------------------------
  // 10. SAFETY
  // --------------------------------

  const currentDrop =
    (close - previous.close)
    / previous.close;

  const safeRecovery =
    currentDrop > -0.015;


  // --------------------------------
  // FINAL BUY
  // --------------------------------

  const buy =
    score >= SCORE_REQUIRED &&
    dropCondition &&
    inBottomZone &&
    bottomQuality &&
    safeRecovery;


  if (dropCondition)
    reasons.push("Valid 24H drop");

  if (inBottomZone)
    reasons.push("Bottom zone");

  if (bottomQuality)
    reasons.push("Bottom quality");

  if (safeRecovery)
    reasons.push("Safe recovery");


  return {

    buy,

    score,

    bottomQuality,

    safeRecovery,

    rsi,

    ema20,

    ema50,

    macd: macdData.macd,

    macdSignal: macdData.signal,

    volumeRatio,

    close,

    time: current.time,

    reasons

  };

}


// ==============================
// RSI
// ==============================

function calculateRSI(candles, length) {

  if (candles.length <= length) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = candles.length - length;
    i < candles.length;
    i++
  ) {

    const change =
      candles[i].close -
      candles[i - 1].close;

    if (change > 0) {

      gains += change;

    } else {

      losses += Math.abs(change);

    }

  }

  const averageGain =
    gains / length;

  const averageLoss =
    losses / length;

  if (averageLoss === 0) {
    return 100;
  }

  const rs =
    averageGain /
    averageLoss;

  return 100 -
    (100 / (1 + rs));

}


// ==============================
// EMA
// ==============================

function calculateEMA(values, length) {

  if (values.length < length) {
    return values[values.length - 1];
  }

  const multiplier =
    2 / (length + 1);

  let ema =
    average(
      values.slice(0, length)
    );

  for (
    let i = length;
    i < values.length;
    i++
  ) {

    ema =
      (values[i] - ema) *
      multiplier +
      ema;

  }

  return ema;

}


// ==============================
// MACD
// ==============================

function calculateMACD(
  values,
  fastLength,
  slowLength,
  signalLength
) {

  const macdValues = [];

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const slice =
      values.slice(0, i + 1);

    const fast =
      calculateEMA(
        slice,
        fastLength
      );

    const slow =
      calculateEMA(
        slice,
        slowLength
      );

    macdValues.push(
      fast - slow
    );

  }

  const macd =
    macdValues[
      macdValues.length - 1
    ];

  const signal =
    calculateEMA(
      macdValues,
      signalLength
    );

  return {
    macd,
    signal
  };

}


// ==============================
// HELPERS
// ==============================

function average(values) {

  if (!values.length) {
    return 0;
  }

  return values.reduce(
    (sum, value) =>
      sum + value,
    0
  ) / values.length;

}


function round(value) {

  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(
    value.toFixed(6)
  );

}


function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );

}


function json(data) {

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {

      headers: {
        "Content-Type":
          "application/json"
      }

    }

  );

}
