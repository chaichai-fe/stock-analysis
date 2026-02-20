import { NextRequest, NextResponse } from "next/server";
import {
  toSecId,
  fetchKline,
  fetchDividend,
  fetchDividendF10,
  isLikelyEtfOrFund,
  fetchFundDividendFromPage,
  fetchEtfDividendFromQuote,
} from "@/lib/eastmoney";

export interface YearlyDividend {
  year: number;
  totalDividend: number;
  dividendYieldPercent: number;
  growthRatePercent: number; // 该年股票增长率 = (年末价 - 年初价) / 年初价 * 100
  yearStartPrice: number;
  yearEndPrice: number;
}

export interface StockAnalysisResult {
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

function toDateStr(s: string): string {
  return s.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  if (!symbol) {
    return NextResponse.json(
      { error: "请提供股票代码，例如 symbol=600519 或 symbol=000001" },
      { status: 400 }
    );
  }

  const sec = toSecId(symbol);
  if (!sec) {
      return NextResponse.json(
        {
          symbol,
          error: "无法识别的股票代码。请输入 6 位 A 股代码（如 600519、000001）",
        } as StockAnalysisResult,
        { status: 400 }
      );
  }

  try {
    const { secid, market } = sec;
    const securityCode = secid.split(".")[1] ?? symbol;

    const kline = await fetchKline(secid);
    const list = kline.list;
    if (!list.length) {
      return NextResponse.json({
        symbol,
        error: "未获取到K线数据，请检查股票代码",
      } as StockAnalysisResult);
    }

    const first = list[0];
    const last = list[list.length - 1];
    const startPrice = first.close;
    const endPrice = last.close;
    const startDate = first.date;
    const endDate = last.date;
    const years =
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
      (365.25 * 24 * 60 * 60 * 1000);

    const cagr =
      years > 0 && startPrice > 0
        ? Math.pow(endPrice / startPrice, 1 / years) - 1
        : 0;
    const cagrPercent = cagr * 100;

    // 计算每年的年初价和年末价
    const firstPriceByYear = new Map<number, number>();
    const lastPriceByYear = new Map<number, number>();
    for (const row of list) {
      const y = new Date(row.date).getFullYear();
      // 年初价：该年第一次出现的价格
      if (!firstPriceByYear.has(y)) {
        firstPriceByYear.set(y, row.close);
      }
      // 年末价：该年最后一次出现的价格（会被不断更新）
      lastPriceByYear.set(y, row.close);
    }

    let dividendList: { year: number; cashPerShare: number }[] = [];
    const fromDatacenter = await fetchDividend(securityCode, market);
    if (fromDatacenter.length > 0) {
      dividendList = fromDatacenter.map((d) => ({
        year: d.year,
        cashPerShare: d.cashPerShare,
      }));
    } else {
      const fromF10 = await fetchDividendF10(secid, market);
      dividendList = fromF10;
    }
    // ETF/场内基金分红在天天基金页，不在 A 股分红接口
    if (dividendList.length === 0 && isLikelyEtfOrFund(securityCode)) {
      // 先尝试quote接口
      const fromQuote = await fetchEtfDividendFromQuote(secid, market);
      if (fromQuote.length > 0) {
        dividendList = fromQuote;
      } else {
        // 再尝试HTML解析
        const fromFundPage = await fetchFundDividendFromPage(securityCode);
        dividendList = fromFundPage;
      }
    }

    const byYear = new Map<number, number>();
    for (const d of dividendList) {
      byYear.set(d.year, (byYear.get(d.year) ?? 0) + d.cashPerShare);
    }

    // 计算所有有价格数据的年份的增长率（包括有分红和没有分红的年份）
    const allYears = new Set<number>();
    for (const y of firstPriceByYear.keys()) allYears.add(y);
    for (const y of byYear.keys()) allYears.add(y);
    
    const yearlyDividends: YearlyDividend[] = [];
    for (const year of Array.from(allYears).sort((a, b) => a - b)) {
      const total = byYear.get(year) ?? 0;
      const yearStartPrice = firstPriceByYear.get(year);
      const yearEndPrice = lastPriceByYear.get(year);
      
      // 计算分红率
      const dividendYieldPercent =
        yearEndPrice && yearEndPrice > 0 ? (total / yearEndPrice) * 100 : 0;
      
      // 计算该年增长率 = (年末价 - 年初价) / 年初价 * 100
      const growthRatePercent =
        yearStartPrice && yearStartPrice > 0 && yearEndPrice
          ? ((yearEndPrice - yearStartPrice) / yearStartPrice) * 100
          : 0;
      
      yearlyDividends.push({
        year,
        totalDividend: Math.round(total * 100) / 100,
        dividendYieldPercent: Math.round(dividendYieldPercent * 100) / 100,
        growthRatePercent: Math.round(growthRatePercent * 100) / 100,
        yearStartPrice: Math.round((yearStartPrice ?? 0) * 100) / 100,
        yearEndPrice: Math.round((yearEndPrice ?? 0) * 100) / 100,
      });
    }
    yearlyDividends.sort((a, b) => a.year - b.year);

    const result: StockAnalysisResult = {
      symbol: securityCode,
      name: kline.name,
      startDate: toDateStr(startDate),
      endDate: toDateStr(endDate),
      startPrice: Math.round(startPrice * 100) / 100,
      endPrice: Math.round(endPrice * 100) / 100,
      years: Math.round(years * 100) / 100,
      cagrPercent: Math.round(cagrPercent * 100) / 100,
      yearlyDividends,
      hasDividends: yearlyDividends.length > 0,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        symbol,
        error: `获取数据失败：${message}`,
      } as StockAnalysisResult,
      { status: 500 }
    );
  }
}
