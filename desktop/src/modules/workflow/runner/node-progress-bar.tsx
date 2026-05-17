import { useState, useEffect } from "react"

export function NodeProgressBar() {
  return (
    <div className="absolute bottom-2 left-2 right-2 h-[3px] rounded-sm overflow-hidden bg-muted">
      <div
        className="absolute top-0 left-0 h-full w-[35%] rounded-sm bg-primary will-change-transform animate-[indeterminate-slide_1.8s_ease-in-out_infinite]"
      />
    </div>
  )
}

export function useRunningTimer(startedAt?: number, active?: boolean): string {
  const [elapsed, setElapsed] = useState("")

  useEffect(() => {
    if (!active || !startedAt) { setElapsed(""); return }
    const update = () => {
      const sec = Math.floor((Date.now() - startedAt) / 1000)
      const m = Math.floor(sec / 60)
      const s = sec % 60
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt, active])

  return elapsed
}
