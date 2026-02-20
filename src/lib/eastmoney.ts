/**
 * 东方财富网站数据接口（爬取）
 * K 线：push2his.eastmoney.com
 * 分红：datacenter-web.eastmoney.com 或 F10 接口
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://quote.eastmoney.com/";

/** 将用户输入的股票代码转为东方财富 secid（市场.代码） */
export function toSecId(symbol: string): { secid: string; market: "sh" | "sz" } | null {
  const raw = symbol.replace(/\s/g, "");
  // 只接受 6 位数字
  const m = raw.match(/^(\d{6})$/);
  if (m) {
    const code = m[1];
    const first = code[0];
    const first2 = code.slice(0, 2);
    
    // 沪市：6/5/9 开头，或 51/56/58 开头的 ETF
    if (["6", "5", "9"].includes(first)) return { secid: `1.${code}`, market: "sh" };
    if (["51", "56", "58"].includes(first2)) return { secid: `1.${code}`, market: "sh" };
    
    // 深市：0/3 开头，或 15/16 开头的 ETF/LOF
    if (["0", "3"].includes(first)) return { secid: `0.${code}`, market: "sz" };
    if (["15", "16"].includes(first2)) return { secid: `0.${code}`, market: "sz" };
  }
  return null;
}

/** 东方财富 K 线接口返回（简化） */
interface EastMoneyKlineRes {
  data?: {
    name?: string;
    klines?: string[]; // 每项格式: "日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率"
  };
  rc?: number;
  rt?: number;
}

/** 获取日 K 线（前复权），从最早到最近 */
export async function fetchKline(secid: string): Promise<{
  name?: string;
  list: { date: string; open: number; close: number; high: number; low: number; volume: number }[];
}> {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  url.searchParams.set("klt", "101"); // 日K
  url.searchParams.set("fqt", "1"); // 前复权
  url.searchParams.set("beg", "0");
  url.searchParams.set("end", "20500000");
  url.searchParams.set("lmt", "100000");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Referer: REFERER },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`K线请求失败: ${res.status}`);
  const json: EastMoneyKlineRes = await res.json();
  if (!json.data?.klines?.length) {
    throw new Error("未返回K线数据，请检查股票代码是否正确（支持沪市/深市 A 股，如 600519、000001）");
  }
  const list = json.data.klines.map((line) => {
    const parts = line.split(",");
    return {
      date: parts[0],
      open: Number(parts[1]),
      close: Number(parts[2]),
      high: Number(parts[3]),
      low: Number(parts[4]),
      volume: Number(parts[5]) || 0,
    };
  });
  return { name: json.data.name, list };
}

/** 东方财富数据中心 - 个股分红送股（常见 reportName） */
const DIVIDEND_REPORT = "RPT_SHAREBONUS_DET";
const DIVIDEND_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";

/** 分红记录（原始字段名可能为中文或英文，按常见接口） */
interface DividendRow {
  SECURITY_CODE?: string;
  REPORT_DATE?: string;
  BONUS_TYPE?: string;
  BASE_SHARE?: string;
  CASH_TOTAL?: string;
  CASH_PER_SHARE?: string;
  EX_DIVIDEND_DATE?: string;
  [key: string]: unknown;
}

/** 获取个股分红数据（东方财富数据中心） */
export async function fetchDividend(securityCode: string, market: "sh" | "sz"): Promise<{
  year: number;
  cashPerShare: number;
  exDate: string;
}[]> {
  // 数据中心接口：filter 按证券代码筛选，columns 选字段
  const filter = `(SECURITY_CODE='${securityCode}')`;
  const url = new URL(DIVIDEND_URL);
  url.searchParams.set("reportName", DIVIDEND_REPORT);
  url.searchParams.set("columns", "SECURITY_CODE,REPORT_DATE,BONUS_TYPE,BASE_SHARE,CASH_TOTAL,CASH_PER_SHARE,EX_DIVIDEND_DATE");
  url.searchParams.set("filter", filter);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", "500");
  url.searchParams.set("sortColumns", "EX_DIVIDEND_DATE");
  url.searchParams.set("sortTypes", "-1");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const raw = json?.data;
  const rows = Array.isArray(raw) ? raw : (raw?.data ?? []) as DividendRow[];
  const result: { year: number; cashPerShare: number; exDate: string }[] = [];
  for (const r of rows) {
    const cash = r.CASH_PER_SHARE ?? r.cashPerShare;
    const exDate = (r.EX_DIVIDEND_DATE ?? r.exDividendDate ?? r.REPORT_DATE ?? "") as string;
    if (!exDate || cash === undefined) continue;
    const num = Number(cash);
    if (Number.isNaN(num) || num <= 0) continue;
    const year = new Date(exDate).getFullYear();
    if (Number.isNaN(year)) continue;
    result.push({ year, cashPerShare: num, exDate: String(exDate).slice(0, 10) });
  }
  return result;
}

/** F10 分红接口返回的 fhyx 单条（分红与询） */
interface F10FhyxRow {
  IMPL_PLAN_PROFILE?: string;
  EX_DIVIDEND_DATE?: string | null;
  NOTICE_DATE?: string;
  [key: string]: unknown;
}

/** 从 "10派3.75元" 或 "10派1.563元" 解析每股派息（元），不分配不转增返回 NaN */
function parseCashPerShareFromProfile(profile: string): number | null {
  if (!profile || /不分配|不转增/i.test(profile)) return null;
  const m = profile.match(/10[派送](\d+\.?\d*)\s*元?/);
  if (!m) return null;
  const num = Number(m[1]);
  return Number.isNaN(num) || num <= 0 ? null : num / 10;
}

/** 备用：F10 分红接口（部分东财页面使用）；支持 fhyx 与 sgbh 两种返回结构 */
export async function fetchDividendF10(secid: string, market: "sh" | "sz"): Promise<{ year: number; cashPerShare: number }[]> {
  const code = secid.split(".")[1] ?? "";
  const symbol = market === "sh" ? `SH${code}` : `SZ${code}`;
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/BonusFinancing/PageAjax?code=${symbol}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  const json = await res.json();

  // 优先解析 fhyx（分红与询）：IMPL_PLAN_PROFILE 如 "10派3.75元"，EX_DIVIDEND_DATE 除息日
  const fhyx = (json?.fhyx ?? []) as F10FhyxRow[];
  if (fhyx.length > 0) {
    const result: { year: number; cashPerShare: number }[] = [];
    for (const row of fhyx) {
      const profile = row.IMPL_PLAN_PROFILE ?? "";
      const cash = parseCashPerShareFromProfile(profile);
      if (cash == null) continue;
      const exDate = row.EX_DIVIDEND_DATE ?? row.NOTICE_DATE ?? "";
      if (!exDate) continue;
      const year = new Date(String(exDate).slice(0, 10)).getFullYear();
      if (year > 1990 && year < 2100) result.push({ year, cashPerShare: cash });
    }
    if (result.length > 0) return result;
  }

  // 兼容旧结构 sgbh
  const list = json?.data?.sgbh?.data ?? json?.sgbh ?? [];
  const result: { year: number; cashPerShare: number }[] = [];
  for (const row of list) {
    const pay = row?.f03 ?? row?.cash ?? row?.每股派息;
    const yearStr = row?.f01 ?? row?.year ?? row?.公告日期;
    if (pay == null) continue;
    const num = Number(pay);
    if (Number.isNaN(num) || num <= 0) continue;
    let year = 0;
    if (typeof yearStr === "number") year = yearStr;
    else if (yearStr) year = new Date(String(yearStr).slice(0, 4)).getFullYear() || Number(String(yearStr).slice(0, 4));
    if (year > 1990 && year < 2100) result.push({ year, cashPerShare: num });
  }
  return result;
}

/** 是否为沪/深 ETF 或场内基金（51xxxx 沪市 ETF，15xxxx 深市 ETF/LOF 等） */
export function isLikelyEtfOrFund(securityCode: string): boolean {
  if (securityCode.length !== 6) return false;
  const first2 = securityCode.slice(0, 2);
  return first2 === "51" || first2 === "56" || first2 === "58" || first2 === "15" || first2 === "16";
}

/**
 * 天天基金 - 基金/ETF 分红送配页（解析 HTML 表格）
 * 页面：fundf10.eastmoney.com/fhsp_{code}.html
 * 表格：年份 | 权益登记日 | 除息日 | 每份分红 | 分红发放日
 */
/**
 * 天天基金 - 基金/ETF 分红送配页（解析 HTML 表格）
 * 页面：fundf10.eastmoney.com/fhsp_{code}.html
 * 表格：年份 | 权益登记日 | 除息日 | 每份分红 | 分红发放日
 */
export async function fetchFundDividendFromPage(securityCode: string): Promise<{ year: number; cashPerShare: number }[]> {
  const url = `https://fundf10.eastmoney.com/fhsp_${securityCode}.html`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://fund.eastmoney.com/" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const result: { year: number; cashPerShare: number }[] = [];
  
  // 方法1: 匹配Markdown表格行：| 2025年 | 2025-12-17 | 2025-12-18 | 每份派现金0.0200元 | 2025-12-23 |
  // 使用更宽松的正则，匹配"年份 | ... | 每份派现金X.XXXX元"
  const rowRe = /(\d{4})年\s*\|\s*[\d-]+\s*\|\s*[\d-]+\s*\|\s*每份派现金\s*([\d.]+)\s*元/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const year = parseInt(m[1], 10);
    const cash = parseFloat(m[2]);
    if (year > 1990 && year < 2100 && !Number.isNaN(cash) && cash > 0) {
      result.push({ year, cashPerShare: cash });
    }
  }
  
  // 方法2: 如果方法1没匹配到，尝试更宽松的模式（允许中间有任意字符）
  if (result.length === 0) {
    const rowRe2 = /(\d{4})年[\s\S]{0,200}?每份派现金\s*([\d.]+)\s*元/g;
    while ((m = rowRe2.exec(html)) !== null) {
      const year = parseInt(m[1], 10);
      const cash = parseFloat(m[2]);
      if (year > 1990 && year < 2100 && !Number.isNaN(cash) && cash > 0) {
        result.push({ year, cashPerShare: cash });
      }
    }
  }
  
  // 方法3: 查找HTML表格中的td标签
  if (result.length === 0) {
    const tdRe = /<td[^>]*>(\d{4})年<\/td>[\s\S]{0,500}?<td[^>]*>每份派现金\s*([\d.]+)\s*元<\/td>/g;
    while ((m = tdRe.exec(html)) !== null) {
      const year = parseInt(m[1], 10);
      const cash = parseFloat(m[2]);
      if (year > 1990 && year < 2100 && !Number.isNaN(cash) && cash > 0) {
        result.push({ year, cashPerShare: cash });
      }
    }
  }
  
  return result;
}

/**
 * 东方财富 quote 页面 - ETF/基金分红（尝试JSON接口）
 * 对于ETF，可能在 quote.eastmoney.com 有数据接口
 */
export async function fetchEtfDividendFromQuote(secid: string, market: "sh" | "sz"): Promise<{ year: number; cashPerShare: number }[]> {
  const code = secid.split(".")[1] ?? "";
  const symbol = market === "sh" ? `SH${code}` : `SZ${code}`;
  
  // 尝试多个可能的API端点
  const urls = [
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=1&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:1+t:3+s:${code}`,
    `https://emweb.securities.eastmoney.com/PC_HSF10/FundArchivesDatas?code=${symbol}&type=sfhsp`,
  ];
  
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
        next: { revalidate: 0 },
      });
      if (!res.ok) continue;
      const text = await res.text();
      // 尝试解析JSON
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        // 可能是JSONP，尝试提取
        const jsonpMatch = text.match(/^\w+\((.*)\)$/);
        if (jsonpMatch) json = JSON.parse(jsonpMatch[1]);
        else continue;
      }
      // 根据实际返回结构解析（需要根据实际API调整）
      if (json?.data && Array.isArray(json.data)) {
        const result: { year: number; cashPerShare: number }[] = [];
        for (const row of json.data) {
          const cash = row?.CASH_PER_SHARE ?? row?.cashPerShare ?? row?.f03;
          const date = row?.EX_DIVIDEND_DATE ?? row?.exDate ?? row?.f01;
          if (cash != null && date) {
            const year = new Date(String(date).slice(0, 10)).getFullYear();
            const num = Number(cash);
            if (year > 1990 && year < 2100 && !Number.isNaN(num) && num > 0) {
              result.push({ year, cashPerShare: num });
            }
          }
        }
        if (result.length > 0) return result;
      }
    } catch {
      continue;
    }
  }
  return [];
}
