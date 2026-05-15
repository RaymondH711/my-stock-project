"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type AccountSummaryRow = {
  id?: number | string;
  initial_capital: number | string | null;
  cash_balance: number | string | null;
};

type PortfolioRow = {
  id?: number | string;
  ticker: string | null;
  shares: number | string | null;
  average_cost: number | string | null;
};

type Props = {
  initialAccount: AccountSummaryRow | null;
  initialPortfolio: PortfolioRow[];
  initialError: string | null;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrency2(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(ratio: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

export default function DashboardClient({
  initialAccount,
  initialPortfolio,
  initialError,
}: Props) {
  const supabase = createBrowserSupabaseClient();
  const [account, setAccount] = useState<AccountSummaryRow | null>(initialAccount);
  const [portfolio, setPortfolio] = useState<PortfolioRow[]>(initialPortfolio);
  const [error, setError] = useState<string | null>(initialError);
  const [tickerError, setTickerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatingCash, setUpdatingCash] = useState(false);
  const [addingPosition, setAddingPosition] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [pricingLoading, setPricingLoading] = useState(false);

  const [cashInput, setCashInput] = useState(
    initialAccount?.cash_balance !== null && initialAccount?.cash_balance !== undefined
      ? String(initialAccount.cash_balance)
      : "",
  );
  const [tickerInput, setTickerInput] = useState("");
  const [sharesInput, setSharesInput] = useState("");
  const [costInput, setCostInput] = useState("");

  const totalMarketValue = useMemo(() => {
    return portfolio.reduce((sum, row) => {
      const shares = toNumber(row.shares);
      if (shares === null) return sum;
      const ticker = (row.ticker ?? "").trim().toUpperCase();
      const livePrice = ticker ? priceMap[ticker] : undefined;
      if (typeof livePrice === "number" && Number.isFinite(livePrice)) {
        return sum + shares * livePrice;
      }
      const fallbackCost = toNumber(row.average_cost);
      if (fallbackCost === null) return sum;
      return sum + shares * fallbackCost;
    }, 0);
  }, [portfolio, priceMap]);

  useEffect(() => {
    let disposed = false;
    const tickers = Array.from(
      new Set(
        portfolio
          .map((row) => (row.ticker ?? "").trim().toUpperCase())
          .filter((ticker) => ticker.length > 0),
      ),
    );
    if (tickers.length === 0) {
      return;
    }

    async function fetchQuotes() {
      setPricingLoading(true);
      const entries = await Promise.all(
        tickers.map(async (ticker) => {
          try {
            const response = await fetch(`/api/check-ticker?ticker=${encodeURIComponent(ticker)}`);
            const data: { valid?: boolean; price?: number } = await response.json();
            if (
              response.ok &&
              data.valid &&
              typeof data.price === "number" &&
              Number.isFinite(data.price)
            ) {
              return [ticker, data.price] as const;
            }
          } catch {
            return null;
          }
          return null;
        }),
      );
      if (disposed) return;
      const nextMap: Record<string, number> = {};
      for (const item of entries) {
        if (!item) continue;
        nextMap[item[0]] = item[1];
      }
      setPriceMap(nextMap);
      setPricingLoading(false);
    }

    fetchQuotes();
    return () => {
      disposed = true;
    };
  }, [portfolio]);

  const initialCapital = account ? toNumber(account.initial_capital) : null;
  const cashBalance = account ? toNumber(account.cash_balance) : null;
  const assetBase =
    cashBalance !== null && Number.isFinite(cashBalance) ? cashBalance + totalMarketValue : null;
  const cashRatio =
    assetBase !== null &&
    assetBase > 0 &&
    cashBalance !== null &&
    Number.isFinite(cashBalance)
      ? cashBalance / assetBase
      : null;
  const cashPercent = cashRatio !== null ? Math.min(100, Math.max(0, cashRatio * 100)) : null;
  const nonCashPercent = cashPercent !== null ? 100 - cashPercent : null;
  const chartCashPercent =
    cashPercent !== null ? Math.min(99.999, Math.max(0.001, cashPercent)) : null;

  async function reloadData() {
    if (!supabase) return;
    const [accountResult, portfolioResult] = await Promise.all([
      supabase.from("account_summary").select("*").limit(1),
      supabase.from("portfolio").select("*").order("ticker", { ascending: true }),
    ]);

    if (accountResult.error) {
      setError(accountResult.error.message);
      return;
    }
    if (portfolioResult.error) {
      setError(portfolioResult.error.message);
      return;
    }

    const nextAccount = (accountResult.data?.[0] as AccountSummaryRow | undefined) ?? null;
    const nextPortfolio = (portfolioResult.data as PortfolioRow[] | null) ?? [];
    setAccount(nextAccount);
    setPortfolio(nextPortfolio);
    setCashInput(
      nextAccount?.cash_balance !== null && nextAccount?.cash_balance !== undefined
        ? String(nextAccount.cash_balance)
        : "",
    );
    setError(null);
  }

  async function handleCashUpdate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    if (!supabase) {
      setError("尚未設定 Supabase 連線資訊。");
      return;
    }

    const nextCash = Number(cashInput);
    if (!Number.isFinite(nextCash) || nextCash < 0) {
      setError("現金餘額請輸入大於等於 0 的數字。");
      return;
    }

    setUpdatingCash(true);
    setError(null);
    const targetId = account?.id;

    const result =
      targetId !== undefined && targetId !== null
        ? await supabase
            .from("account_summary")
            .update({ cash_balance: nextCash })
            .eq("id", targetId)
        : await supabase.from("account_summary").update({ cash_balance: nextCash });

    if (result.error) {
      if (!account) {
        const insertResult = await supabase
          .from("account_summary")
          .insert({ cash_balance: nextCash })
          .select("*")
          .limit(1);
        if (insertResult.error) {
          setError(insertResult.error.message);
          setUpdatingCash(false);
          return;
        }
      } else {
        setError(result.error.message);
        setUpdatingCash(false);
        return;
      }
    }

    await reloadData();
    setNotice("現金餘額已更新。");
    setUpdatingCash(false);
  }

  async function handleAddPosition(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    setTickerError(null);
    if (!supabase) {
      setError("尚未設定 Supabase 連線資訊。");
      return;
    }

    const ticker = tickerInput.trim().toUpperCase();
    setTickerInput(ticker);
    const shares = Number(sharesInput);
    const averageCost = Number(costInput);
    const positionCost = shares * averageCost;
    if (!ticker) {
      setError("請輸入股票代號。");
      return;
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      setError("股數請輸入大於 0 的數字。");
      return;
    }
    if (!Number.isFinite(averageCost) || averageCost <= 0) {
      setError("平均成本請輸入大於 0 的數字。");
      return;
    }
    if (!Number.isFinite(positionCost) || positionCost <= 0) {
      setError("倉位金額計算失敗，請確認股數與平均成本。");
      return;
    }

    setAddingPosition(true);
    setError(null);
    try {
      const verifyResponse = await fetch(`/api/check-ticker?ticker=${encodeURIComponent(ticker)}`, {
        method: "GET",
      });
      const verifyData: { valid?: boolean } = await verifyResponse.json();
      if (!verifyResponse.ok || !verifyData.valid) {
        setTickerError("找不到該股票代號，請重新確認");
        setAddingPosition(false);
        return;
      }
    } catch {
      setTickerError("找不到該股票代號，請重新確認");
      setAddingPosition(false);
      return;
    }

    const { error: insertError } = await supabase.from("portfolio").insert({
      ticker,
      shares,
      average_cost: averageCost,
    });
    if (insertError) {
      console.error("Supabase insert portfolio error:", insertError);
      alert(insertError.message);
      setError(insertError.message);
      setAddingPosition(false);
      return;
    }

    if (account && cashBalance !== null) {
      const targetId = account.id;
      const nextCashBalance = cashBalance - positionCost;
      const updateResult =
        targetId !== undefined && targetId !== null
          ? await supabase
              .from("account_summary")
              .update({ cash_balance: nextCashBalance })
              .eq("id", targetId)
          : await supabase.from("account_summary").update({ cash_balance: nextCashBalance });
      if (updateResult.error) {
        console.error("Supabase update cash_balance error:", updateResult.error);
        alert(updateResult.error.message);
        setError(updateResult.error.message);
        setAddingPosition(false);
        return;
      }
    }

    await reloadData();
    setTickerInput("");
    setSharesInput("");
    setCostInput("");
    setNotice("倉位已新增。");
    setAddingPosition(false);
  }

  async function handleDeletePosition(row: PortfolioRow) {
    if (!supabase) {
      setError("尚未設定 Supabase 連線資訊。");
      return;
    }
    const key = String(row.id ?? `${row.ticker}-${row.shares}-${row.average_cost}`);
    setDeletingKey(key);
    setNotice(null);
    setError(null);

    let query = supabase.from("portfolio").delete();
    if (row.id !== undefined && row.id !== null) {
      query = query.eq("id", row.id);
    } else {
      query = query
        .eq("ticker", row.ticker ?? "")
        .eq("shares", row.shares ?? 0)
        .eq("average_cost", row.average_cost ?? 0);
    }

    const { error: deleteError } = await query;
    if (deleteError) {
      setError(deleteError.message);
      setDeletingKey(null);
      return;
    }

    const deletedShares = toNumber(row.shares);
    const deletedCost = toNumber(row.average_cost);
    if (
      account &&
      cashBalance !== null &&
      deletedShares !== null &&
      deletedCost !== null &&
      Number.isFinite(deletedShares) &&
      Number.isFinite(deletedCost)
    ) {
      const targetId = account.id;
      const recoverCash = deletedShares * deletedCost;
      const updateResult =
        targetId !== undefined && targetId !== null
          ? await supabase
              .from("account_summary")
              .update({ cash_balance: cashBalance + recoverCash })
              .eq("id", targetId)
          : await supabase.from("account_summary").update({ cash_balance: cashBalance + recoverCash });
      if (updateResult.error) {
        console.error("Supabase recover cash_balance error:", updateResult.error);
        alert(updateResult.error.message);
        setError(updateResult.error.message);
        setDeletingKey(null);
        return;
      }
    }

    await reloadData();
    setNotice("倉位已刪除。");
    setDeletingKey(null);
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-1 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-400/90">
              Portfolio
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              帳戶總覽
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              即時檢視資產，並可直接更新現金與管理現有倉位。
            </p>
          </div>
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400 sm:mt-0">
            資料來源：
            <span className="ml-1 font-mono text-slate-200">account_summary / portfolio</span>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <p className="font-medium text-amber-50">操作失敗</p>
            <p className="mt-1 text-amber-100/90">{error}</p>
          </div>
        )}
        {tickerError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {tickerError}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {notice}
          </div>
        )}

        <main className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <section className="rounded-2xl border border-sky-500/25 bg-sky-500/10 p-5 shadow-lg shadow-sky-950/40 backdrop-blur sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wide text-sky-100/80">
              資產配置甜甜圈圖
            </p>
            {cashPercent === null || nonCashPercent === null || chartCashPercent === null ? (
              <p className="mt-3 text-sm text-sky-100/80">資料不足，無法繪製甜甜圈圖。</p>
            ) : (
              <div className="mt-4 flex items-center gap-4">
                <div
                  className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full border border-white/20"
                  style={{
                    background: `conic-gradient(#34d399 0% ${chartCashPercent}%, #38bdf8 ${chartCashPercent}% 100%)`,
                  }}
                  aria-label="資產配置甜甜圈圖，綠色為現金，藍色為非現金資產"
                >
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-900/95 ring-1 ring-white/10">
                    <span className="font-mono text-xs font-semibold text-emerald-200">
                      {formatPercent(cashPercent / 100)}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-2 text-emerald-200">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    現金：{formatPercent(cashPercent / 100)}
                  </p>
                  <p className="flex items-center gap-2 text-sky-200">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" />
                    非現金：{formatPercent(nonCashPercent / 100)}
                  </p>
                </div>
              </div>
            )}
            <p className="mt-4 text-xs text-sky-100/70">非現金資產以「倉位成本總額」估算。</p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/30 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">初始資金</p>
            <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-white sm:text-3xl">
              {initialCapital === null ? "—" : formatCurrency(initialCapital)}
            </p>
            <p className="mt-2 text-xs text-slate-500">initial_capital</p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/30 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">現金餘額</p>
            <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-emerald-300 sm:text-3xl">
              {cashBalance === null ? "—" : formatCurrency(cashBalance)}
            </p>
            <p className="mt-2 text-xs text-slate-500">cash_balance</p>
          </section>

          <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5 shadow-lg shadow-emerald-950/40 backdrop-blur sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-200/80">
              現金佔初始資金比例
            </p>
            <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-emerald-100 sm:text-3xl">
              {cashRatio === null ? "—" : formatPercent(cashRatio)}
            </p>
            {cashRatio !== null && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-emerald-200/70">
                  <span>0%</span>
                  <span>100%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-emerald-950/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-[width]"
                    style={{ width: `${cashPercent}%` }}
                  />
                </div>
              </div>
            )}
            <p className="mt-3 text-xs text-emerald-200/60">
              {assetBase !== null && assetBase > 0
                ? "計算方式：現金餘額 ÷ (現金餘額 + 倉位成本總額)"
                : "現金與倉位資料不足，無法計算比例。"}
            </p>
          </section>

          <section className="rounded-2xl border border-emerald-400/30 bg-white/[0.03] p-5 shadow-lg shadow-black/30 backdrop-blur sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-200">更新現金</p>
            <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCashUpdate}>
              <label className="flex-1">
                <span className="text-xs text-slate-400">cash_balance</span>
                <input
                  id="cash-balance"
                  name="cash_balance"
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-emerald-400/40 transition focus:ring-2"
                  placeholder="輸入新的現金餘額"
                />
              </label>
              <button
                type="submit"
                disabled={updatingCash}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updatingCash ? "更新中..." : "更新現金"}
              </button>
            </form>
          </section>
        </main>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg shadow-black/30 backdrop-blur">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Portfolio</p>
              <h2 className="mt-1 text-xl font-semibold text-white">現有倉位管理</h2>
            </div>
            <p className="text-sm text-slate-400">
              目前 {portfolio.length} 檔，估算總市值：{" "}
              <span className="font-mono text-slate-200">{formatCurrency(totalMarketValue)}</span>
            </p>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {pricingLoading ? "即時報價更新中..." : "市值優先使用即時市價，缺值時改用平均成本估算。"}
          </p>

          <form className="mt-5 grid gap-3 sm:grid-cols-4" onSubmit={handleAddPosition}>
            <label className="sm:col-span-1">
              <span className="text-xs text-slate-400">股票代號 (Ticker)</span>
              <input
                id="ticker"
                name="ticker"
                type="text"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-sky-400/40 transition focus:ring-2"
                placeholder="AAPL"
              />
            </label>
            <label className="sm:col-span-1">
              <span className="text-xs text-slate-400">股數 (Shares)</span>
              <input
                id="shares"
                name="shares"
                type="number"
                min="0.0001"
                step="0.0001"
                value={sharesInput}
                onChange={(e) => setSharesInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-sky-400/40 transition focus:ring-2"
                placeholder="10"
              />
            </label>
            <label className="sm:col-span-1">
              <span className="text-xs text-slate-400">平均成本 (Average Cost)</span>
              <input
                id="average-cost"
                name="average_cost"
                type="number"
                min="0.0001"
                step="0.0001"
                value={costInput}
                onChange={(e) => setCostInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-sky-400/40 transition focus:ring-2"
                placeholder="182.5"
              />
            </label>
            <button
              type="submit"
              disabled={addingPosition}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-1"
            >
              {addingPosition ? "驗證與寫入中..." : "新增倉位"}
            </button>
          </form>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium">Shares</th>
                  <th className="px-3 py-2 font-medium">Average Cost</th>
                  <th className="px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={4}>
                      目前沒有倉位，請先新增。
                    </td>
                  </tr>
                ) : (
                  portfolio.map((row) => {
                    const key = String(row.id ?? `${row.ticker}-${row.shares}-${row.average_cost}`);
                    return (
                      <tr key={key} className="border-b border-white/5 text-slate-200">
                        <td className="px-3 py-3 font-mono">{row.ticker ?? "-"}</td>
                        <td className="px-3 py-3 font-mono">
                          {toNumber(row.shares)?.toLocaleString("zh-TW") ?? "-"}
                        </td>
                        <td className="px-3 py-3 font-mono">
                          {toNumber(row.average_cost) !== null
                            ? formatCurrency2(toNumber(row.average_cost) ?? 0)
                            : "-"}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => handleDeletePosition(row)}
                            disabled={deletingKey === key}
                            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingKey === key ? "刪除中..." : "刪除"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
