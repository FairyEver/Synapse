import { Button } from "@/components/ui/button"

type QueryState = {
  error: string | null
  loading: boolean
  online: boolean
  refresh: () => Promise<void>
}
export function GameQueryFeedback({ query }: { query: QueryState }) {
  if (!query.error) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm">
      <span>{query.error}</span>
      <Button
        type="button"
        variant="outline"
        disabled={query.loading || !query.online}
        onClick={() => void query.refresh()}
      >
        重试
      </Button>
    </div>
  )
}
