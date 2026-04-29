import * as React from "react"

interface ResourceState<T> {
  readonly data: T | null
  readonly error: string | null
  readonly loading: boolean
  readonly reload: () => void
}

export function useApiResource<T>(
  load: () => Promise<T>,
  dependencies: React.DependencyList = [],
): ResourceState<T> {
  const [data, setData] = React.useState<T | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    load()
      .then((result) => {
        if (!alive) return
        setData(result)
      })
      .catch((caught: unknown) => {
        if (!alive) return
        setError(caught instanceof Error ? caught.message : "请求失败")
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [version, ...dependencies])

  return {
    data,
    error,
    loading,
    reload: React.useCallback(() => setVersion((value) => value + 1), []),
  }
}
