import { useState, useEffect } from "react"

export function NodeProgressBar() {
  return (
    <div className="absolute bottom-2 left-2 right-2 h-[3px] rounded-sm overflow-hidden" style={{ background: "#27272a" }}>
      <div
        className="absolute top-0 left-0 h-full w-[35%] rounded-sm"
        style={{
          background: "linear-gradient(90deg, #2563eb, #3b82f6, #60a5fa, #93c5fd, #60a5fa, #3b82f6)",
          backgroundSize: "200% 100%",
          willChange: "transform",
          animation: "indeterminate-slide 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite, indeterminate-shimmer 3s linear infinite",
        }}
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
