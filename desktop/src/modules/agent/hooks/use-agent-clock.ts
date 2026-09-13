import { useEffect, useState } from "react"

/** 只由可见的计时文字订阅，避免每秒更新整条时间线。 */
export function useAgentClock(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
