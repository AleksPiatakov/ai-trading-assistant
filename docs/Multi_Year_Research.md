# Extended 10-market, 1–3-year historical research

This module extends the previous single-market backtest without changing the live trading rules or enabling exchange orders.

## How to use
1. Run `node scripts/local-demo-server.mjs` on the Mac.
2. Open `http://127.0.0.1:4177/`, click **Статистика**.
3. Choose **1, 2, or 3 years** and click **Аналіз усіх 10 пар**.
4. Keep the local Node server running while Bybit history is downloaded and tested. The interface polls status; downloading multiple years for ten instruments can require substantial time, network calls and local disk space.
5. Browse per-pair train/OOS results and the baseline vs strict variant comparison.

## Scope and data
The fixed watchlist contains BTC, ETH, SOL, XRP, BNB, DOGE, ADA, LINK, AVAX, and DOT USDT linear perpetual contracts. Only instruments currently available from Bybit are included. The research downloads public **15m / 1h / 4h / 1D** OHLCV in batches of up to 1,000 candles, retaining 220 preceding daily bars for EMA200 warm-up. It does not invent earlier history for newly listed products. All candle cache files are local:

`~/Library/Application Support/AI Trading Assistant/historical-research/history/<SYMBOL>-<TF>.json`

Files are cached and extended incrementally when expanding the analysis horizon. API outages or missing history appear as per-symbol errors. The page displays actual test periods in per-symbol results internally; selecting 3 years **does not guarantee** that each asset has 3 years of usable history.

## Strategy variants and out-of-sample
- **Baseline:** unchanged existing four-timeframe scanner rules.
- **Strict:** identical rules with an additional requirement that all four checked timeframes confirm the direction.
- Split is chronological and fixed **70%/30% of the requested historical horizon**. Metrics are shown separately for the initial ("train") part and the last, untouched ("OOS") part.
- Only the initial 70% is used to select the higher-mean-R variant, and **only if the variant recorded at least 30 closed training trades**. If the sample is smaller, no variant is selected.
- Neither variant is automatically promoted to the live strategy.
- The train/OOS separation is a basic safeguard, not a formal demonstration of generalization. Repeated tests and repeated decision-making from OOS results would contaminate it.

## Execution assumptions
- Evaluates only candles closed before the signal, and uses the next hourly candle's opening price for the backtest fill.
- Maximum hold 48 hours, no overlapping orders in one symbol.
- Estimated fee 0.055% per side and adverse slippage 0.05% per side. Same-bar SL/TP resolves at SL. Stop gaps use the worse opening price.
- Assumptions are illustrative; real Bybit fee tiers, funding, changing spreads, thin liquidity, price impact, partial fills, leverage risk and taxes are not modelled.
- R measures gain/loss relative to trade risk; mean R is **not** guaranteed percent account return.
- Multiple simultaneously open trades across different symbols are not modelled as a capital-constrained portfolio.
- No real trades are placed. Historical reports remain research artifacts, not recommendations.

## Monitoring and validation
`GET /api/strategy/multi-year` returns status and statistics; `POST /api/strategy/multi-year` with `{"years":1|2|3}` starts a single local read-only job, protected by same-origin checks and an explicit local header. Concurrent jobs are rejected. A test run stops when all ten symbols have been processed; the browser's status UI may close while the local server continues.

Tests: `node .github/scripts/check-multi-year-research.mjs` plus the existing strategy, browser, and scanner regression suites. Synthetic fixtures test the software plumbing, not predictive performance. Real results require downloading live exchange OHLCV on the user's Mac.
