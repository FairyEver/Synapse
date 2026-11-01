export function PersonaBadge({
  version,
}: {
  version?: { versionNo: number; persona: string } | null
}) {
  return version ? (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer">v{version.versionNo}</summary>
      <p className="mt-2 max-w-prose whitespace-pre-wrap break-words">{version.persona || "空提示词"}</p>
    </details>
  ) : (
    <span className="text-xs text-muted">—</span>
  )
}
