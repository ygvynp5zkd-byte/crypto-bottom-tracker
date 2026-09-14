const COINS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
  "XRPUSDT", "LINKUSDT", "AVAXUSDT", "SUIUSDT",
  "LTCUSDT", "DOGEUSDT", "ADAUSDT", "TRXUSDT",
  "DOTUSDT", "SHIBUSDT", "UNIUSDT", "AAVEUSDT",
  "NEARUSDT", "ATOMUSDT", "FILUSDT", "ARBUSDT",
  "OPUSDT", "INJUSDT", "SEIUSDT", "TIAUSDT"
];

const TAKE_PROFIT = 0.02;
const STOP_LOSS = 0.015;

// --------------------------------------------------
// Basic indicator functions
// --------------------------------------------------

function sma(values, length) {
  if (values.length < length) return null;

  let sum = 0;
  for (let i = values.length - length; i < values.length; i++) {
    sum += values[i];
  }

  return sum / length;
}

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

function rsiSeries(values, length) {
  const result = new Array(values.length).fill(null);

  if (values.length <= length) return result;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= length; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) {
      gain += change;
    } else {
      loss -= change;
    }
  }

  gain /= length;
  loss /= length;

  result[length] =
    loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);

  for (let i = length + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? -change : 0;

    gain = ((gain * (length - 1)) + currentGain) / length;
    loss = ((loss * (length - 1)) + currentLoss) / length;

    result[i] =
      loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }

  return result;
}

function highest(values, length, index) {
  let highestValue = -Infinity;
  const start = Math.max(0, index - length + 1);

  for (let i = start; i <= index; i++) {
    highestValue = Math.max(highestValue, values[i]);
  }

  return highestValue;
}

function lowest(values, length, index) {
  let lowestValue = Infinity;
  const start = Math.max(0, index - length + 1);

  for (let i = start; i <= index; i++) {
    lowestValue = Math.min(lowestValue, values[i]);
  }

  return lowestValue;
}

// --------------------------------------------------
// MACD
// --------------------------------------------------

function macdHistogram(values) {
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);

  const macd = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      macd[i] = ema12[i] - ema26[i];
    }
  }

  const signal = new Array(values.length).fill(null);
  const raw = [];

  for (let i = 0; i < macd.length; i++) {
    if (macd[i] !== null) {
      raw.push({
        index: i,
        value: macd[i]
      });
    }
  }

  if (raw.length >= 9) {
    let sum = 0;

    for (let i = 0; i < 9; i++) {
      sum += raw[i].value;
    }

    signal[raw[8].index] = sum / 9;

    const multiplier = 2 / 10;

    for (let i = 9; i < raw.length; i++) {
      const previous = signal[raw[i - 1].index];

      signal[raw[i].index] =
        (raw[i].value - previous) * multiplier +
        previous;
    }
  }

  const histogram = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    if (macd[i] !== null && signal[i] !== null) {
      histogram[i] = macd[i] - signal[i];
    }
  }

  return {
    macd,
    signal,
    histogram
  };
}

// --------------------------------------------------
// V2.4 BUY SIGNAL
// --------------------------------------------------

function calculateBuySignal(candles) {

  const closes = candles.map(c => c.close);
  const opens = candles.map(c => c.open);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const i = candles.length - 1;

  // V2.4 settings
  const lookback24 = 96;
  const bottomZone = 20;
  const minDrop = 3;
  const maxDrop = 30;

  const bottomLookback = 20;
  const bottomTolerance = 1;
  const minBottomTests = 2;

  const rsiLength = 14;
  const rsiMax = 50;

  const emaFastLength = 20;

  const volumeLength = 20;
  const volumeMultiplier = 1.1;

  const requiredScore = 5;

  // Need enough history
  if (i < 110) {
    return false;
  }

  // -----------------------------------------------
  // 24H RANGE
  // -----------------------------------------------

  const lowest24 = lowest(lows, lookback24, i);
  const highest24 = highest(highs, lookback24, i);

  const range24 = highest24 - lowest24;

  const distanceFromLow =
    range24 > 0
      ? ((closes[i] - lowest24) / range24) * 100
      : 100;

  const nearBottom =
    distanceFromLow <= bottomZone;

  // -----------------------------------------------
  // 24H CHANGE
  // -----------------------------------------------

  const pricePast = closes[i - lookback24];

  const change24 =
    pricePast !== 0
      ? ((closes[i] - pricePast) / pricePast) * 100
      : 0;

  const strongDrop =
    change24 <= -minDrop &&
    change24 >= -maxDrop;

  // -----------------------------------------------
  // RECENT BOTTOM
  // -----------------------------------------------

  const recentLow =
    lowest(lows, bottomLookback, i);

  const bottomReference =
    recentLow * (1 + bottomTolerance / 100);

  let bottomTests = 0;

  for (
    let j = i - bottomLookback + 1;
    j <= i;
    j++
  ) {
    const candleBottomReference =
      lowest(lows, bottomLookback, j) *
      (1 + bottomTolerance / 100);

    if (lows[j] <= candleBottomReference) {
      bottomTests++;
    }
  }

  const qualityBottom =
    bottomTests >= minBottomTests;

  const nearRecentBottom =
    lows[i] <=
    recentLow * (1 + bottomTolerance / 100);

  // -----------------------------------------------
  // BOTTOM REJECTION
  // -----------------------------------------------

  const candleRange =
    highs[i] - lows[i];

  const lowerWick =
    Math.min(opens[i], closes[i]) - lows[i];

  const lowerWickPercent =
    candleRange > 0
      ? (lowerWick / candleRange) * 100
      : 0;

  const bottomRejection =
    candleRange > 0 &&
    lowerWickPercent >= 35 &&
    closes[i] >
      lows[i] + candleRange * 0.55;

  // -----------------------------------------------
  // SELLING PRESSURE
  // -----------------------------------------------

  const body =
    Math.abs(closes[i] - opens[i]);

  const bodyPrevious =
    Math.abs(closes[i - 1] - opens[i - 1]);

  const sellingPressureWeakening =
    closes[i] > closes[i - 1] &&
    body <= bodyPrevious * 1.5;

  // -----------------------------------------------
  // RSI
  // -----------------------------------------------

  const rsi = rsiSeries(closes, rsiLength);

  const currentRSI = rsi[i];
  const previousRSI = rsi[i - 2];

  const rsiRising =
    currentRSI !== null &&
    previousRSI !== null &&
    currentRSI > previousRSI;

  const rsiCondition =
    currentRSI !== null &&
    currentRSI <= rsiMax &&
    rsiRising;

  // -----------------------------------------------
  // EMA
  // -----------------------------------------------

  const emaFast =
    emaSeries(closes, emaFastLength);

  const emaRecovery =
    closes[i] > emaFast[i];

  const emaTurningUp =
    emaFast[i] > emaFast[i - 2];

  // -----------------------------------------------
  // MACD
  // -----------------------------------------------

  const macd =
    macdHistogram(closes);

  const histCurrent =
    macd.histogram[i];

  const histPrevious =
    macd.histogram[i - 1];

  const macdCurrent =
    macd.macd[i];

  const macdPrevious =
    macd.macd[i - 1];

  const macdImproving =
    histCurrent !== null &&
    histPrevious !== null &&
    histCurrent > histPrevious;

  const macdTurningUp =
    macdCurrent !== null &&
    macdPrevious !== null &&
    macdCurrent > macdPrevious;

  // -----------------------------------------------
  // VOLUME
  // -----------------------------------------------

  const averageVolume =
    sma(volumes, volumeLength);

  const volumeStrong =
    averageVolume !== null &&
    volumes[i] >
      averageVolume * volumeMultiplier;

  // -----------------------------------------------
  // BULLISH CANDLE
  // -----------------------------------------------

  const bullishCandle =
    closes[i] > opens[i];

  const strongClose =
    candleRange > 0 &&
    closes[i] >=
      lows[i] + candleRange * 0.60;

  const recoveryCandle =
    bullishCandle &&
    strongClose;

  // -----------------------------------------------
  // SCORE
  // -----------------------------------------------

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

  // -----------------------------------------------
  // SAFETY
  // -----------------------------------------------

  const lastDrop =
    closes[i] <
    closes[i - 1] * 0.985;

  const safeRecovery =
    !lastDrop;

  // -----------------------------------------------
  // BOTTOM QUALITY
  // -----------------------------------------------

  const bottomQualitySignal =
    qualityBottom &&
    nearRecentBottom &&
    bottomRejection &&
    sellingPressureWeakening;

  return (
    score >= requiredScore &&
    bottomQualitySignal &&
    safeRecovery
  );
}

// --------------------------------------------------
// Binance data
// --------------------------------------------------

async function getCandles(symbol) {

  const url =
    "https://api.binance.com/api/v3/klines" +
    `?symbol=${symbol}` +
    "&interval=15m" +
    "&limit=130";

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Binance ${symbol}: ${response.status}`
    );
  }

  const data =
    await response.json();

  /*
    The last Binance candle can still be open.
    We therefore remove it and use the latest CLOSED
    15-minute candle.
  */

  if (data.length < 120) {
    throw new Error(
      `Not enough candles for ${symbol}`
    );
  }

  const closed =
    data.slice(0, -1);

  return closed.map(k => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5])
  }));
}

// --------------------------------------------------
// D1
// --------------------------------------------------

async function ensureTable(env) {

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

  const result =
    await env.DB
      .prepare(`
        SELECT *
        FROM trades
        WHERE symbol = ?
      `)
      .bind(symbol)
      .first();

  return result || {
    symbol,
    active: 0,
    entry: null,
    tp: null,
    sl: null,
    entry_time: null
  };
}

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

// --------------------------------------------------
// Telegram
// --------------------------------------------------

async function sendTelegram(
  env,
  message
) {

  const url =
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response =
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        chat_id:
          env.TELEGRAM_CHAT_ID,
        text: message
      })
    });

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Telegram error: ${text}`
    );
  }
}

// --------------------------------------------------
// Process one coin
// --------------------------------------------------

async function processCoin(
  symbol,
  env
) {

  const candles =
    await getCandles(symbol);

  const latest =
    candles[candles.length - 1];

  const buySignal =
    calculateBuySignal(candles);

  const trade =
    await getTrade(env, symbol);

  // -----------------------------------------------
  // Existing OPEN trade
  // -----------------------------------------------

  if (trade.active === 1) {

    let closed = false;

    /*
      SL is checked first if both TP and SL are touched
      in the same candle. This is the conservative choice.
    */

    if (latest.low <= trade.sl) {

      await saveTrade(
        env,
        symbol,
        false,
        null,
        null,
        null,
        null
      );

      closed = true;

    } else if (
      latest.high >= trade.tp
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

      closed = true;
    }

    /*
      IMPORTANT:
      We do NOT care whether buySignal is true or false
      while the trade is OPEN.

      The trade remains OPEN until TP or SL.
    */

    return {
      symbol,
      status:
        closed ? "CLOSED" : "OPEN",
      buySignal
    };
  }

  // -----------------------------------------------
  // No active trade -> check for NEW BUY
  // -----------------------------------------------

  if (buySignal) {

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
      "🔔 NEW BUY OPEN\n\n" +
      `🪙 ${symbol}\n` +
      "⏱ TF: 15m\n\n" +
      `📈 Entry: ${entry}\n` +
      `🎯 TP: ${tp}\n` +
      `🛑 SL: ${sl}\n\n` +
      "Strategy: 24H Bottom Recovery V2.4";

    await sendTelegram(
      env,
      message
    );

    return {
      symbol,
      status: "NEW BUY",
      buySignal: true,
      entry,
      tp,
      sl
    };
  }

  return {
    symbol,
    status: "WAIT",
    buySignal: false
  };
}

// --------------------------------------------------
// Main worker
// --------------------------------------------------

export default {

  async fetch(request, env) {

    try {

      await ensureTable(env);

      const results = [];

      for (const symbol of COINS) {

        try {

          const result =
            await processCoin(
              symbol,
              env
            );

          results.push(result);

        } catch (error) {

          results.push({
            symbol,
            status: "ERROR",
            error:
              error.message
          });
        }
      }

      return new Response(
        JSON.stringify(
          {
            ok: true,
            checked: COINS.length,
            results
          },
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

    } catch (error) {

      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message
        }),
        {
          status: 500,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );
    }
  },

  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      (async () => {

        await ensureTable(env);

        for (const symbol of COINS) {

          try {

            await processCoin(
              symbol,
              env
            );

          } catch (error) {

            console.error(
              symbol,
              error.message
            );
          }
        }

      })()
    );
  }
};
