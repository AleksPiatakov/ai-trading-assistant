// Public, unauthenticated Bybit market candles. Never accepts API keys or order requests.
const intervals = new Set(["1", "3", "5", "15", "30", "60", "120", "240", "D", "W"]);
const symbols = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol") ?? "BTCUSDT";
  const interval = params.get("interval") ?? "D";
  if (!symbols.has(symbol) || !intervals.has(interval)) {
    return Response.json({ error: "Некоректна пара або інтервал" }, { status: 400 });
  }
  try {
    const url = new URL("https://api.bybit.com/v5/market/kline");
    url.searchParams.set("category", "linear");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "220");
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Bybit HTTP " + response.status);
    const data: {
      retCode?: number;
      retMsg?: string;
      result?: { list?: string[][] };
    } = await response.json();
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      throw new Error(data.retMsg || "Invalid exchange response");
    }
    const candles = data.result.list
      .map((row) => ({
        t: Number(row[0]), o: Number(row[1]), h: Number(row[2]),
        l: Number(row[3]), c: Number(row[4]), v: Number(row[5]),
      }))
      .filter((x) => Object.values(x).every(Number.isFinite))
      .reverse();
    return Response.json(
      { source: "Bybit public market API", category: "linear", symbol, interval, candles, updatedAt: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Немає зв'язку з публічним Bybit Market API", candles: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
