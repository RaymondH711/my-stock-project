import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawTicker = searchParams.get("ticker") ?? "";
  const ticker = rawTicker.trim().toUpperCase();

  if (!ticker) {
    return NextResponse.json({ valid: false });
  }

  try {
    const response = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
      {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json({ valid: false });
    }

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const meta = result?.meta;
    const regularMarketPrice = meta?.regularMarketPrice;

    if (meta && typeof regularMarketPrice === "number" && Number.isFinite(regularMarketPrice)) {
      return NextResponse.json({ valid: true, price: regularMarketPrice });
    }

    return NextResponse.json({ valid: false });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
