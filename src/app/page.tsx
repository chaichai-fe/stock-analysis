"use client";

import { useState, FormEvent, useMemo } from "react";

interface YearlyDividend {
  year: number;
  totalDividend: number;
  dividendYieldPercent: number;
  growthRatePercent: number;
  yearStartPrice: number;
  yearEndPrice: number;
}

interface StockAnalysisResult {
  symbol: string;
  name?: string;
  startDate: string;
  endDate: string;
  startPrice: number;
  endPrice: number;
  years: number;
  cagrPercent: number;
  yearlyDividends: YearlyDividend[];
  hasDividends: boolean;
  error?: string;
}

export default function Home() {
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StockAnalysisResult | null>(null);
  const [principalInput, setPrincipalInput] = useState("100000");
  const [reinvest, setReinvest] = useState(false);

  const principal = principalInput === "" ? 0 : Number(principalInput) || 0;

  const simulation = useMemo(() => {
    if (!result || result.error || !result.yearlyDividends.length) return null;
    const rows = result.yearlyDividends;
    const startIndex = rows.findIndex((r) => r.yearStartPrice > 0);
    if (startIndex < 0) return { canSimulate: false as const };
    const buyPrice = rows[startIndex].yearStartPrice;
    if (principal <= 0 || buyPrice <= 0) return { canSimulate: false as const };
    let shares = principal / buyPrice;
    let totalCashReceived = 0;
    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      const cash = shares * row.totalDividend;
      if (reinvest && row.yearEndPrice > 0) {
        shares += cash / row.yearEndPrice;
      } else {
        totalCashReceived += cash;
      }
    }
    const endValue = shares * result.endPrice;
    const totalReturn = endValue + totalCashReceived - principal;
    const totalReturnPercent = (totalReturn / principal) * 100;
    const totalTerminal = endValue + totalCashReceived;
    // 年化收益率按实际持有年数计算：从买入年年初到 endDate
    const entryYear = rows[startIndex].year;
    const endDateMs = new Date(result.endDate).getTime();
    const entryDateMs = new Date(entryYear, 0, 1).getTime();
    const holdingYears = (endDateMs - entryDateMs) / (365.25 * 24 * 60 * 60 * 1000);
    const cagrPercent =
      holdingYears > 0 && principal > 0
        ? (Math.pow(totalTerminal / principal, 1 / holdingYears) - 1) * 100
        : 0;
    return {
      canSimulate: true,
      endValue,
      totalCashReceived,
      totalReturn,
      totalReturnPercent,
      cagrPercent,
    };
  }, [result, principal, reinvest]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const code = symbol.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(code)}`);
      const data: StockAnalysisResult = await res.json();
      if (!res.ok) {
        setResult({ ...data, symbol: code });
        return;
      }
      setResult(data);
    } catch (err) {
      setResult({
        symbol: code,
        startDate: "",
        endDate: "",
        startPrice: 0,
        endPrice: 0,
        years: 0,
        cagrPercent: 0,
        yearlyDividends: [],
        hasDividends: false,
        error: err instanceof Error ? err.message : "请求失败",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-800 dark:text-stone-200">
          股票分析
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          输入 A 股代码（如 600519、000001），查看自上市以来的年化收益率与历年分红率。数据来源：东方财富。
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex gap-3">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="输入股票代码"
            className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-stone-900 placeholder-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500"
            disabled={loading}
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !symbol.trim()}
            className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600"
          >
            {loading ? "查询中…" : "查询"}
          </button>
        </form>

        {result && (
          <section className="mt-8 rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900">
            {result.error ? (
              <p className="text-red-600 dark:text-red-400">{result.error}</p>
            ) : (
              <>
                <div className="border-b border-stone-200 pb-4 dark:border-stone-700">
                  <h2 className="text-lg font-medium text-stone-800 dark:text-stone-200">
                    {result.name ?? result.symbol}
                  </h2>
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    {result.startDate} ～ {result.endDate}（约 {result.years} 年）
                  </p>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-sm text-stone-500 dark:text-stone-400">
                      自成立起平均年化收益率（CAGR）
                    </p>
                    <p className="mt-0.5 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                      {result.cagrPercent.toFixed(2)}%
                    </p>
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      期初价 {result.startPrice} → 期末价 {result.endPrice}
                    </p>
                  </div>

                  {result.yearlyDividends.length > 0 ? (
                    <div>
                      <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
                        每年数据统计（增长率 = (年末价 - 年初价) / 年初价 × 100%）
                      </p>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[400px] text-sm">
                          <thead>
                            <tr className="border-b border-stone-200 text-left text-stone-500 dark:border-stone-700 dark:text-stone-400">
                              <th className="py-2 pr-4 font-medium">年份</th>
                              <th className="py-2 pr-4 font-medium">股票增长率</th>
                              <th className="py-2 font-medium">分红率</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.yearlyDividends.map((row) => (
                              <tr
                                key={row.year}
                                className="border-b border-stone-100 dark:border-stone-800"
                              >
                                <td className="py-2 pr-4">{row.year}</td>
                                <td
                                  className={`py-2 pr-4 font-medium ${
                                    row.growthRatePercent >= 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-red-600 dark:text-red-400"
                                  }`}
                                >
                                  {row.growthRatePercent >= 0 ? "+" : ""}
                                  {row.growthRatePercent.toFixed(2)}%
                                </td>
                                <td className="py-2">
                                  {row.dividendYieldPercent > 0
                                    ? `${row.dividendYieldPercent.toFixed(2)}%`
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-stone-500 dark:text-stone-400">
                      暂无年度数据记录。
                    </p>
                  )}

                  {result.yearlyDividends.length > 0 && (
                    <div className="mt-6 border-t border-stone-200 pt-6 dark:border-stone-700">
                      <h3 className="text-base font-medium text-stone-800 dark:text-stone-200">
                        模拟投资
                      </h3>
                      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        基于上市首日买入并持有至最近交易日，分红按年发放。
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-2">
                          <span className="text-sm text-stone-600 dark:text-stone-400">投入本金（元）</span>
                          <input
                            type="number"
                            min={1}
                            step={1000}
                            value={principalInput}
                            onChange={(e) => setPrincipalInput(e.target.value)}
                            className="w-32 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
                          />
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={reinvest}
                            onChange={(e) => setReinvest(e.target.checked)}
                            className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 dark:border-stone-600 dark:bg-stone-800"
                          />
                          <span className="text-sm text-stone-600 dark:text-stone-400">分红复投</span>
                        </label>
                      </div>
                      {simulation?.canSimulate ? (
                        <div className="mt-4 space-y-2 rounded-lg bg-stone-100 p-4 dark:bg-stone-800">
                          <p className="text-sm text-stone-600 dark:text-stone-400">
                            期末市值：<span className="font-medium text-stone-900 dark:text-stone-100">{simulation.endValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</span>
                          </p>
                          {!reinvest && simulation.totalCashReceived > 0 && (
                            <p className="text-sm text-stone-600 dark:text-stone-400">
                              累计分红：<span className="font-medium text-stone-900 dark:text-stone-100">{simulation.totalCashReceived.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</span>
                            </p>
                          )}
                          <p className="text-sm text-stone-600 dark:text-stone-400">
                            总收益：<span className={`font-medium ${simulation.totalReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{simulation.totalReturn.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</span>
                            （{simulation.totalReturn >= 0 ? "+" : ""}{simulation.totalReturnPercent.toFixed(2)}%）
                          </p>
                          <p className="text-sm text-stone-600 dark:text-stone-400">
                            年化收益率：<span className={`font-medium ${simulation.cagrPercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{simulation.cagrPercent >= 0 ? "+" : ""}{simulation.cagrPercent.toFixed(2)}%</span>
                          </p>
                        </div>
                      ) : simulation && !simulation.canSimulate ? (
                        <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">
                          暂无足够数据模拟，或请填写有效本金。
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
