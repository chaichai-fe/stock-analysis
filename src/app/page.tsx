import { StockAnalysisClient } from '@/components/StockAnalysisClient'

export default function Home() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-800 dark:text-stone-200">
          股票分析
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          输入 A 股代码（如 600519、000001），查看自上市以来的年化收益率与历年分红率。数据来源：东方财富。
        </p>

        <StockAnalysisClient />
      </div>
    </div>
  )
}
