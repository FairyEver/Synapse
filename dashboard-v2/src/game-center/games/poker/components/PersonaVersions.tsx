import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { Skeleton } from "@heroui/react"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
export function PersonaVersions({ agentId }: { agentId: string }) {
  const versions = useGameQuery(
    () => gameApi().poker.agent.versions({ agentId }),
    `poker:versions:${agentId}`,
  )
  return (
    <section className="space-y-3">
      <h3 className="font-medium">版本历史</h3>
      <GameQueryFeedback query={versions} />
      {!versions.data && !versions.error ? (
        <Skeleton className="h-20 w-full" />
      ) : versions.data?.length === 0 ? (
        <p className="text-sm text-muted">尚无提示词版本</p>
      ) : (
        versions.data?.map((version) => (
          <details key={version.id} className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm">
              v{version.versionNo} · {version.handCount} 手 ·{" "}
              {version.firstUsedAt ? new Date(version.firstUsedAt).toLocaleString() : "尚未使用"}
            </summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm">
              {version.persona || "空提示词"}
            </p>
          </details>
        ))
      )}
    </section>
  )
}
