import { z } from "zod"

export const TERMINAL_WORKSPACE_PANE_LIMIT = 8

export type TerminalPaneLeaf = {
  readonly type: "leaf"
  readonly paneId: string
  readonly sessionId: string
}

export type TerminalSplitNode = {
  readonly type: "split"
  readonly splitId: string
  readonly direction: "horizontal" | "vertical"
  readonly ratio: number
  readonly first: TerminalLayoutNode
  readonly second: TerminalLayoutNode
}

export type TerminalLayoutNode = TerminalPaneLeaf | TerminalSplitNode

export type TerminalPaneSplitPathEntry = {
  readonly splitId: string
  readonly paneSide: "first" | "second"
}

export const terminalPaneLeafSchema = z.object({
  type: z.literal("leaf"),
  paneId: z.string().min(1),
  sessionId: z.string().min(1),
}).strict()

export const terminalLayoutNodeSchema: z.ZodType<TerminalLayoutNode> = z.lazy(() => z.union([
  terminalPaneLeafSchema,
  z.object({
    type: z.literal("split"),
    splitId: z.string().min(1),
    direction: z.enum(["horizontal", "vertical"]),
    ratio: z.number().min(0.05).max(0.95),
    first: terminalLayoutNodeSchema,
    second: terminalLayoutNodeSchema,
  }).strict(),
]))

export const terminalWorkspaceSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  layout: terminalLayoutNodeSchema,
  layoutRevision: z.number().int().positive(),
  closingPaneIds: z.array(z.string().min(1)).default([]),
  closing: z.boolean().default(false),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const terminalWorkspaceIdInputSchema = z.object({
  workspaceId: z.string().min(1),
}).strict()

export const terminalRenameWorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  expectedLayoutRevision: z.number().int().positive(),
}).strict()

export const terminalSplitPaneInputSchema = z.object({
  workspaceId: z.string().min(1),
  paneId: z.string().min(1),
  direction: z.enum(["right", "down"]),
  expectedLayoutRevision: z.number().int().positive(),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional(),
}).strict()

export const terminalSplitPaneResultSchema = z.object({
  workspace: terminalWorkspaceSchema,
  paneId: z.string().min(1),
  sessionId: z.string().min(1),
}).strict()

export const terminalPaneDropEdgeSchema = z.enum(["top", "right", "bottom", "left"])

export const terminalMovePaneInputSchema = z.object({
  workspaceId: z.string().min(1),
  sourcePaneId: z.string().min(1),
  targetPaneId: z.string().min(1),
  edge: terminalPaneDropEdgeSchema,
  expectedLayoutRevision: z.number().int().positive(),
}).strict()

export const terminalSetSplitRatioInputSchema = z.object({
  workspaceId: z.string().min(1),
  splitId: z.string().min(1),
  ratio: z.number().min(0.05).max(0.95),
  expectedLayoutRevision: z.number().int().positive(),
}).strict()

export const terminalClosePaneInputSchema = z.object({
  workspaceId: z.string().min(1),
  paneId: z.string().min(1),
  expectedLayoutRevision: z.number().int().positive(),
  force: z.boolean().optional(),
}).strict()

export const terminalCloseWorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1),
  expectedLayoutRevision: z.number().int().positive(),
  force: z.boolean().optional(),
}).strict()

export const terminalCloseWorkspaceResultSchema = z.object({
  workspaceId: z.string().min(1),
  state: z.enum(["closing", "deleted"]),
  remainingSessionIds: z.array(z.string().min(1)),
}).strict()

export type TerminalWorkspace = z.infer<typeof terminalWorkspaceSchema>
export type TerminalRenameWorkspaceInput = z.infer<typeof terminalRenameWorkspaceInputSchema>
export type TerminalSplitPaneInput = z.infer<typeof terminalSplitPaneInputSchema>
export type TerminalSplitPaneResult = z.infer<typeof terminalSplitPaneResultSchema>
export type TerminalPaneDropEdge = z.infer<typeof terminalPaneDropEdgeSchema>
export type TerminalMovePaneInput = z.infer<typeof terminalMovePaneInputSchema>
export type TerminalSetSplitRatioInput = z.infer<typeof terminalSetSplitRatioInputSchema>
export type TerminalClosePaneInput = z.infer<typeof terminalClosePaneInputSchema>
export type TerminalCloseWorkspaceInput = z.infer<typeof terminalCloseWorkspaceInputSchema>
export type TerminalCloseWorkspaceResult = z.infer<typeof terminalCloseWorkspaceResultSchema>

export function collectTerminalPaneLeaves(layout: TerminalLayoutNode): TerminalPaneLeaf[] {
  if (layout.type === "leaf") return [layout]
  return [...collectTerminalPaneLeaves(layout.first), ...collectTerminalPaneLeaves(layout.second)]
}

export function findTerminalPane(layout: TerminalLayoutNode, paneId: string): TerminalPaneLeaf | null {
  if (layout.type === "leaf") return layout.paneId === paneId ? layout : null
  return findTerminalPane(layout.first, paneId) ?? findTerminalPane(layout.second, paneId)
}

export function findTerminalPaneSplitPath(
  layout: TerminalLayoutNode,
  paneId: string,
): TerminalPaneSplitPathEntry[] | null {
  if (layout.type === "leaf") return layout.paneId === paneId ? [] : null
  const firstPath = findTerminalPaneSplitPath(layout.first, paneId)
  if (firstPath) return [{ splitId: layout.splitId, paneSide: "first" }, ...firstPath]
  const secondPath = findTerminalPaneSplitPath(layout.second, paneId)
  return secondPath
    ? [{ splitId: layout.splitId, paneSide: "second" }, ...secondPath]
    : null
}

export function splitTerminalPane(
  layout: TerminalLayoutNode,
  paneId: string,
  split: Pick<TerminalSplitNode, "splitId" | "direction" | "ratio">,
  nextPane: TerminalPaneLeaf,
): TerminalLayoutNode | null {
  if (layout.type === "leaf") {
    if (layout.paneId !== paneId) return null
    return {
      type: "split",
      splitId: split.splitId,
      direction: split.direction,
      ratio: split.ratio,
      first: layout,
      second: nextPane,
    }
  }
  const first = splitTerminalPane(layout.first, paneId, split, nextPane)
  if (first) return { ...layout, first }
  const second = splitTerminalPane(layout.second, paneId, split, nextPane)
  return second ? { ...layout, second } : null
}

export function removeTerminalPane(
  layout: TerminalLayoutNode,
  paneId: string,
): TerminalLayoutNode | null | undefined {
  if (layout.type === "leaf") return layout.paneId === paneId ? null : undefined
  const first = removeTerminalPane(layout.first, paneId)
  if (first !== undefined) return first === null ? layout.second : { ...layout, first }
  const second = removeTerminalPane(layout.second, paneId)
  if (second !== undefined) return second === null ? layout.first : { ...layout, second }
  return undefined
}

export function moveTerminalPane(
  layout: TerminalLayoutNode,
  sourcePaneId: string,
  targetPaneId: string,
  edge: TerminalPaneDropEdge,
  splitId: string,
): TerminalLayoutNode | null {
  if (sourcePaneId === targetPaneId) return null
  const sourcePane = findTerminalPane(layout, sourcePaneId)
  const targetPane = findTerminalPane(layout, targetPaneId)
  if (!sourcePane || !targetPane) return null

  const withoutSource = removeTerminalPane(layout, sourcePaneId)
  if (!withoutSource) return null
  const direction = edge === "left" || edge === "right" ? "horizontal" : "vertical"
  const sourceFirst = edge === "left" || edge === "top"
  return insertTerminalPane(withoutSource, targetPaneId, {
    type: "split",
    splitId,
    direction,
    ratio: 0.5,
    first: sourceFirst ? sourcePane : targetPane,
    second: sourceFirst ? targetPane : sourcePane,
  })
}

function insertTerminalPane(
  layout: TerminalLayoutNode,
  targetPaneId: string,
  split: TerminalSplitNode,
): TerminalLayoutNode | null {
  if (layout.type === "leaf") return layout.paneId === targetPaneId ? split : null
  const first = insertTerminalPane(layout.first, targetPaneId, split)
  if (first) return { ...layout, first }
  const second = insertTerminalPane(layout.second, targetPaneId, split)
  return second ? { ...layout, second } : null
}

export function setTerminalSplitRatio(
  layout: TerminalLayoutNode,
  splitId: string,
  ratio: number,
): TerminalLayoutNode | null {
  if (layout.type === "leaf") return null
  if (layout.splitId === splitId) return { ...layout, ratio }
  const first = setTerminalSplitRatio(layout.first, splitId, ratio)
  if (first) return { ...layout, first }
  const second = setTerminalSplitRatio(layout.second, splitId, ratio)
  return second ? { ...layout, second } : null
}
