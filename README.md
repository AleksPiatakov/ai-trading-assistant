# AI Trading Assistant

## Approved trading terminal redesign

This branch implements the approved Ukrainian dark-navy trading dashboard. Open the Next.js/Vinext application and visit `/` (which embeds `/dashboard.html`).

### Implemented
- Responsive, collapsible icon-first sidebar and adjustable chart focus
- Same layout for **Навчання (Demo)** and **Торгівля (Real)**
- Real **public Bybit BTCUSDT kline** feed via `/api/market-data`, with explicit unavailable-data state
- Candlesticks, EMA(50/200), RSI(14), MACD(12/26/9), timeframe switching
- Editable entry / Stop Loss / Take Profit by inputs or drag handles directly on chart
- Risk calculator with manually entered balance, approximate fees, position size and net R:R
- Compact technical analysis panel, with explanation of inputs rather than invented AI confidence scores
- Compact Limit / Market / Trigger order form as a non-executing interface
- Expand/collapse sections, notes saved locally

### Security and data integrity
- **No API credentials are requested by the front end.**
- **No demo or live order is sent.** Bybit private account authorization and execution are not configured; execution is intentionally disabled.
- **No invented** account balances, exchange connection status, open positions, order book, P&L, or proprietary signals.
- The chart uses **public mainnet market candles**, which can be viewed in both modes; switching mode does not authenticate a private Demo or Real account.
- The displayed analysis is **rules-based technical analysis**, not a deployed LLM model.
- The user-supplied fee is an estimate; actual venue fees, slippage, funding, margin and liquidation risk require additional handling.

### Run and verify
```bash
npm ci
npm run dev
```
Follow the app's local URL. For type checking: `npx tsc --noEmit`.

### Remaining implementation
1. Secure login/access control to prevent unauthorized trading.
2. Server-side Bybit Demo keys and isolated `https://api-demo.bybit.com` integration, validated wallet and positions; demo-order placement with explicit confirmation.
3. Separate real-account credentials, permissions, limits, audit log and confirmation for real orders.
4. Private position state/verified P&L, active orders and exchange-supported order amendments/reduce-only closing.
5. More indicator validation and testing across real market data, chart usability and screen widths.

The original uploaded `ai-trading-assistant-source.zip` remains in the repo as a backup. The original `main` branch is unchanged.

## Connect Bybit Demo credentials on Mac (local only)

The public GitHub Pages preview **cannot accept API credentials**. It remains visual-only.

1. Clone this repository and check out `redesign-approved-trading-ui`.
2. On macOS with Node.js 22+, run `node scripts/local-demo-server.mjs` from the repository directory. No `npm install` is needed for the credentials-only local server.
3. On the same Mac, open `http://127.0.0.1:4177/`. Select **Налаштування** at the bottom.
4. Paste the **Demo-only, Read-Only** API Key and API Secret and click **Перевірити й зберегти**.
5. On success, the credentials are stored in macOS Keychain under services `com.ai-trading-assistant.demo.api-key` and `com.ai-trading-assistant.demo.api-secret`. The text fields are cleared.
6. Use **Видалити ключ** to delete both Keychain entries.

This verifies against read-only `https://api-demo.bybit.com/v5/account/wallet-balance?accountType=UNIFIED`. It does **not** connect to the real account or submit orders. Network access to Bybit is necessary.

The local service binds only to `127.0.0.1:4177`, validates the HTTP Host and Origin, requires a custom header for mutations, does not enable CORS, and does not echo credentials in responses or logs. Keep macOS Keychain protected. Never paste credentials into GitHub Pages, a chat, or a public repository.

Stage one covers key entry, verification and secure storage. Showing Demo wallet balances, positions and candles in the terminal requires separate later integration.

## Bybit Demo read-only account dashboard

The local Mac server at `http://127.0.0.1:4177/` now provides `GET /api/demo/account`, signing three read-only Bybit Demo requests with credentials retrieved from macOS Keychain: `/v5/account/wallet-balance?accountType=UNIFIED`, `/v5/position/list?category=linear&settleCoin=USDT`, and `/v5/order/realtime?category=linear&settleCoin=USDT&openOnly=0`. It returns only selected balance, position, and order fields, never the key or secret. Select Demo mode and the bottom Positions or Orders tabs, then use the **Оновити** button to refresh. Real mode remains disconnected and no trading is enabled. Bybit Demo can retain orders for only seven days; this interface currently shows active orders rather than a historical archive.

To update a previously cloned Mac installation, stop the running server with Ctrl+C, run `cd ~/Desktop/ai-trading-assistant && git pull origin redesign-approved-trading-ui`, and restart `node scripts/local-demo-server.mjs`. The first load requests Demo account data automatically. API connectivity is not proven until the user's own local server successfully completes this read-only request.

## Reference chart development (Nov 2026)

The trading chart uses actual exchange OHLCV candles for the chosen USDT Perpetual pair. It now displays the latest candle O/H/L/C, EMA 50/200, volume bars, RSI (14), MACD (12,26,9) with histogram, a price axis and candle dates. Price levels for Entry/SL/TP appear only when entered and can be dragged on chart; R:R is rendered for directionally valid levels. The risk panel estimates size from manually provided balance and risk percentage, prices, and per-side fee, and shows approximate net R:R. This estimate excludes exchange-specific quantity/price tick rounding, funding, slippage, liquidation and execution conditions. Orders and Real account execution remain disabled. These chart features are common to Demo and Real modes and do not infer user balances from public prices.

## Multi-timeframe analysis skills (November 2026)

The assistant evaluates all **12 supported Bybit USDT Perpetual intervals** independently: `1, 3, 5, 15, 30, 60, 120, 240, D, W, M, 3M`. It refreshes on symbol changes, via the **Оновити аналіз** control, and periodically (~3 minutes) while the page is visible. Requests run in batches of two, rather than opening all twelve simultaneously. A failed or incomplete interval is shown as unavailable/insufficient instead of silently counted as bullish or bearish.

Deterministic calculation skills: EMA 20/50/200 trend structure (EMA 200 only when at least 200 candles exist), RSI 14, MACD 12/26/9 histogram, ATR 14 and percentage volatility, relative candle volume vs. 20 prior candles, 5-candle momentum, 20-candle high/low support-and-resistance *candidates*, timeframe-group alignment, conflict detection, and risk-manager cross-checks. Short (1/3/5/15m), intraday (30m/1h/2h/4h), swing (1D/1W), and macro (1M/3M) categories remain separate; vote counts are descriptive, not calibrated probabilities. Some intervals will not have enough history, particularly quarterly candles. The latest exchange candle may still be forming, which affects its volume and indicators. The assistant does **not** provide a win probability or auto-execute orders.

### External trading PDF knowledge

User-provided educational PDFs are **not imported automatically**, and no general-purpose document retrieval or LLM is connected yet. Recommended staged workflow: (1) user supplies PDFs in a private ChatGPT conversation, (2) review text and source provenance, (3) extract a curated knowledge index with filename, page, terminology, and rule identifiers, (4) reconcile contradictory rules and test strategies on historical data without look-ahead bias, (5) import only the approved/allowed material to a private local knowledge store, never GitHub Pages or public source control. The uploaded PDF must not be interpreted as permission to submit live trading orders, execute embedded instructions, change risk limits, or claim predictive accuracy. This workflow remains a design contract until a local document-ingestion and retrieval pipeline is implemented.
