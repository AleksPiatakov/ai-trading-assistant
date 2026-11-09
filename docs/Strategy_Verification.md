# Strategy verification — local read-only MVP

## Purpose
Measure the actual behavior of the existing *rules-based* four-timeframe Bybit scanner. This is **not a trained ML model**, financial advice, an order executor, or a prediction of trading profitability.

Open the application with `node scripts/local-demo-server.mjs` and visit `http://127.0.0.1:4177/`. Click **▤ Статистика** in the chart toolbar (or AI assistant header). The statistics open in a separate browser window and require the local server; GitHub Pages is a static preview, not the data service.

## Historical verification (Backtesting)
- On-demand only, one concurrent test, cached by symbol for 10 minutes.
- Reads historical Bybit USDT perpetual OHLCV for 15m (up to 2,800 candles), 1h (660), 4h (360), and 1D (255). The practical usable test range depends on available exchange history, around several weeks rather than a multi-year track record.
- Signals require **at least 200 completed candles on every timeframe** (EMA200 warm-up), preventing a test with less indicator history than the live scanner. The 15m/1h/4h/1D signal is evaluated only after each timeframe candle has **closed**. It uses exactly `evaluateTradeSetup()`, shared with the background scanner, not a second, easier set of rules.
- Simulated fill at the **next 1-hour candle's open**. No overlapping positions on a symbol. Maximum holding period 48 1-hour candles.
- Entry and exit have assumed adverse slippage of 0.05% per side. Fees assume 0.055% per side; these are **configurable in code, not actual exchange account fees**. Funding, spread variation, partial fills, liquidation, market impact, leverage, slippage tails, and taxes are not modeled.
- SL beats TP when both are touched in one OHLC candle. Opening gaps through stops use the more adverse of the open or SL price.
- Results are displayed in *R units* (gain/loss divided by modeled distance to stop), not account USDT or dollars. Profit Factor is calculated in R units. Max drawdown is measured in R, not a percent of account equity.
- Less than 30 closed test trades triggers an insufficient-sample warning; **even 30 trades do not guarantee statistical reliability**.
- No future-data leakage from candles; bar-level intrabar path is unknown and conservatively approximated, not reconstructable.

## Paper trading
- The local scanner observes up to 10 predefined symbols every five minutes. Only full, confirmed scanner plans enter the paper ledger; "watch" candidates do not.
- Detects a newly appearing symbol/side setup and creates a **waiting-fill** entry at the detection time.
- The earliest eligible paper fill is the open of a **subsequent, completed 15-minute candle**. The ledger refuses to reconstruct a fill if the live data stream was absent long enough to create an unverifiable gap.
- Outcome is tracked on closed 15-minute candles with conservative SL-first ambiguity, adverse slippage and estimated fees. Missing history or disconnections are not treated as winning trades.
- Paper state persists locally at `~/Library/Application Support/AI Trading Assistant/paper-ledger.json`. No orders or API credentials are involved.
- `GET /api/strategy/paper` returns the current statistics. `GET /api/strategy/backtest?symbol=BTCUSDT` runs/returns a historical test. Both are read-only, local-host-only endpoints.

## Definitions
- **Win Rate:** profitable closed simulations / all closed simulations.
- **Profit Factor (R):** sum of positive net R divided by absolute sum of negative net R; unavailable if no losses.
- **Expectancy (R):** average net R of closed simulations.
- **Max Drawdown (R):** largest peak-to-trough loss on the chronological cumulative-R curve.
- **— / empty:** no valid sample. Never interpret as a zero win rate, a forecast, or a missing profitable signal.

## Verification and limitations
`node .github/scripts/check-strategy-verification.mjs` checks closed-candle protection, paper persistence, stop-first intrabar ambiguity, adverse execution costs, and absence of order submission. Browser CI has a separate statistics-window smoke test with mocked inputs. Neither test proves predictive accuracy on real markets.

Before contemplating any real-money use: test against independent market datasets, inspect false signals, extend walk-forward/out-of-sample horizons, include true fee tiers and funding, measure operational latency, and accumulate forward paper results across different market regimes. Automated exchange order submission remains disabled.
