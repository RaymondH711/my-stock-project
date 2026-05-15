import { createServerSupabaseClient } from "@/lib/supabase/server";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

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

export default async function Home() {
  const supabase = createServerSupabaseClient();

  let account: AccountSummaryRow | null = null;
  let portfolio: PortfolioRow[] = [];
  let fetchError: string | null = null;

  if (!supabase) {
    fetchError =
      "請在 .env.local 設定 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY。";
  } else {
    const [accountResult, portfolioResult] = await Promise.all([
      supabase.from("account_summary").select("*").limit(1),
      supabase.from("portfolio").select("*").order("ticker", { ascending: true }),
    ]);

    if (accountResult.error) {
      fetchError = accountResult.error.message;
    } else if (portfolioResult.error) {
      fetchError = portfolioResult.error.message;
    } else {
      account = (accountResult.data?.[0] as AccountSummaryRow | undefined) ?? null;
      portfolio = (portfolioResult.data as PortfolioRow[] | null) ?? [];
    }
  }

  return <DashboardClient initialAccount={account} initialPortfolio={portfolio} initialError={fetchError} />;
}
