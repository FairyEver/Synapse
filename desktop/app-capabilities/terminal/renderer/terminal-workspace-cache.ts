import { TERMINAL_RENDERER_CACHED_PANES, TERMINAL_RENDERER_CACHED_WORKSPACES } from "../../../config"
import { collectTerminalPaneLeaves, type TerminalWorkspace } from "../shared/workspace"

/** 当前标签优先，按最近访问顺序保留；渲染本帧就应用上限，避免 effect 之前短暂挂载额外实例。 */
export function retainedTerminalWorkspaces(
  recent: readonly string[],
  activeId: string | null,
  workspaces: readonly TerminalWorkspace[],
): readonly string[] {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  if (!activeId || !byId.has(activeId)) return []
  const retained: string[] = []
  let paneCount = 0
  for (const id of [activeId, ...recent]) {
    if (retained.includes(id)) continue
    const workspace = byId.get(id)
    if (!workspace) continue
    const panes = collectTerminalPaneLeaves(workspace.layout).length
    if (retained.length > 0 && paneCount + panes > TERMINAL_RENDERER_CACHED_PANES) continue
    retained.push(id)
    paneCount += panes
    if (retained.length === TERMINAL_RENDERER_CACHED_WORKSPACES) break
  }
  return retained
}
