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
