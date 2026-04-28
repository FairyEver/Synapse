import { Spinner } from "@/components/ui/spinner"

function AgentRunStatus({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground" aria-live="polite">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export { AgentRunStatus }
