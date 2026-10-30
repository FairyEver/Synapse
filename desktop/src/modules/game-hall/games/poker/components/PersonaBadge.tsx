export function PersonaBadge({
  version,
}: {
  version?: { versionNo: number; persona: string } | null
}) {
  return version ? (
    <details className="persona-version">
      <summary>v{version.versionNo}</summary>
      <p className="whitespace-pre-wrap break-words">{version.persona || "空提示词"}</p>
    </details>
  ) : (
    <span className="persona-version">—</span>
  )
}
