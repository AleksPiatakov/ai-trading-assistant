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
