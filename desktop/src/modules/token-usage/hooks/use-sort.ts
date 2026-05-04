import { useState, useMemo } from "react"

export function useSort<T>(data: T[], defaultKey: keyof T & string, defaultDir: "asc" | "desc" = "desc") {
  const [sortKey, setSortKey] = useState<keyof T & string>(defaultKey)
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultDir)

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av
      }
      const as = String(av)
      const bs = String(bv)
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [data, sortKey, sortDir])

  const toggleSort = (key: keyof T & string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  return { sorted, sortKey, sortDir, toggleSort }
}
