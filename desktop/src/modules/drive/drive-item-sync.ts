import type { DriveItemDto, DriveItemBatchResponse, DriveItemAncestorDto, DriveSyncBindingDto, DriveSyncSnapshotDto } from "@synapse/shared"
import { isDriveSyncExcluded } from "@/lib/drive-sync-excludes"
import { activeWorkOf, retryOperationOf } from "./sync/drive-sync-copy"

export interface DriveSyncPathEntry { readonly id: string | null; readonly name: string }
export type DriveItemSyncRelation =
  | { readonly kind: "bound"; readonly binding: DriveSyncBindingDto; readonly inherited: boolean; readonly relativePath: string; readonly itemType: DriveItemDto["type"]; readonly excluded: boolean; readonly localPath: string }
  | { readonly kind: "contains"; readonly bindings: readonly DriveSyncBindingDto[]; readonly incomplete: boolean }
  | { readonly kind: "unknown"; readonly loading: boolean }

/** ID 确认归属后才用名称生成相对路径；绝不按同名或旧路径提示猜测关系。 */
export function getDriveItemSyncRelation(item: DriveItemDto, path: readonly DriveSyncPathEntry[], bindings: readonly DriveSyncBindingDto[]): DriveItemSyncRelation | null {
  const active = bindings.filter((binding) => binding.status !== "removed")
  const direct = active.find((binding) => binding.driveItemId === item.id)
  const ancestor = [...path].reverse().find((entry) => active.some((binding) => binding.kind === "folder" && binding.driveItemId === entry.id))
  const binding = direct ?? active.find((candidate) => candidate.driveItemId === ancestor?.id && candidate.kind === "folder")
  if (!binding) return null
  const parts = direct ? [] : [...path.slice(path.findIndex((entry) => entry.id === binding.driveItemId) + 1).map((entry) => entry.name), item.name]
  // 云端异常名称不能映射到本机根目录之外，也不能传给 ignore 库造成异常。
  if (parts.some((part) => !part || part === "." || part === ".." || /[/\\\0]/u.test(part))) return { kind: "unknown", loading: false }
  const relativePath = parts.join("/")
  const separator = /^[a-z]:[\\/]|^\\\\/iu.test(binding.localPath) ? "\\" : "/"
  const localPath = parts.length ? `${binding.localPath.replace(/[\\/]+$/u, "")}${separator}${parts.join(separator)}` : binding.localPath
  return { kind: "bound", binding, inherited: !direct, relativePath, itemType: item.type, localPath, excluded: isDriveSyncExcluded(relativePath, binding.excludeRules, item.type) }
}

export interface ContainedDriveBindings {
  readonly bindings: ReadonlyMap<string, readonly string[]>
  readonly failed: boolean
}

/** 只查询绑定根的祖先链，不枚举整个云盘；同一轮共用父节点请求。 */
export async function findContainedDriveBindings(
  items: readonly DriveItemDto[], bindings: readonly DriveSyncBindingDto[], path: readonly DriveSyncPathEntry[],
  getRemote: (id: string) => Promise<DriveItemDto>, signal?: AbortSignal,
  getRemoteBatch?: (ids: readonly string[]) => Promise<DriveItemBatchResponse>,
  crossLevel = false,
): Promise<ContainedDriveBindings> {
  const folders = new Set(items.filter((item) => item.type === "folder").map((item) => item.id))
  const knownRoots = new Set(crossLevel ? [] : [...path.map((entry) => entry.id), ...items.map((item) => item.id)])
  const contained = new Map<string, string[]>()
  const requests = new Map<string, Promise<DriveItemAncestorDto>>()
  const batchedNodes = new Map<string, DriveItemAncestorDto>()
  const batchedFailures = new Set<string>()
  let failed = false
  if (!folders.size) return { bindings: contained, failed }
  const get = (id: string) => {
    if (getRemoteBatch) {
      const node = batchedNodes.get(id)
      if (batchedFailures.has(id) || !node) return Promise.reject(new Error("云盘同步关系查询失败。"))
      return Promise.resolve(node)
    }
    let request = requests.get(id)
    if (!request) { request = getRemote(id); requests.set(id, request) }
    return request
  }
  const candidates = bindings.filter((binding) => binding.status !== "removed" && !knownRoots.has(binding.driveItemId))
  if (getRemoteBatch && candidates.length && !signal?.aborted) {
    try {
      const response = await getRemoteBatch(candidates.map((binding) => binding.driveItemId))
      for (const result of response.results) {
        if (result.error || !result.data) { batchedFailures.add(result.itemId); continue }
        for (const node of [...result.data.ancestors, result.data.item]) batchedNodes.set(node.id, node)
      }
    } catch {
      return { bindings: contained, failed: true }
    }
  }
  for (let offset = 0; offset < candidates.length && !signal?.aborted; offset += 4) {
    await Promise.all(candidates.slice(offset, offset + 4).map(async (binding) => {
      const visited = new Set<string>()
      let id: string | null = binding.driveItemId
      try {
        while (id && !signal?.aborted) {
          if (visited.has(id) || visited.size >= 256) throw new Error("Invalid Drive ancestry")
          visited.add(id)
          const node = await get(id)
          if (node.id !== id) throw new Error("Drive ancestry mismatch")
          const parentId: string | null = node.parentId
          if (parentId && folders.has(parentId)) {
            contained.set(parentId, [...(contained.get(parentId) ?? []), binding.id])
            if (!crossLevel) break
          }
          if (knownRoots.has(parentId)) break
          id = parentId
        }
      } catch {
        failed = true
      }
    }))
  }
  return { bindings: contained, failed }
}

export interface DriveItemSyncStatus { readonly label: string; readonly detail: string; readonly attention?: boolean }
export function getDriveItemSyncStatus(relation: DriveItemSyncRelation, snapshot: DriveSyncSnapshotDto | null): DriveItemSyncStatus {
  if (relation.kind === "unknown") return { label: relation.loading ? "同步状态加载中" : "同步状态未知", detail: relation.loading ? "正在读取同步关系" : "同步状态加载失败", attention: !relation.loading }
  if (relation.kind === "contains") return { label: "含同步项", detail: relation.incomplete ? "已找到以下同步项，其他内容的同步关系尚未确认。" : "仅以下项目与本机同步，其他内容不会同步。" }
  if (relation.excluded) return { label: "已排除同步", detail: "已被文件夹的排除规则排除，本机与云盘的修改不会同步。" }
  const { binding, relativePath, itemType } = relation
  const relevant = (candidate: string) => !relativePath || candidate === "" || candidate === relativePath || (itemType === "folder" && candidate.startsWith(`${relativePath}/`)) || (candidate !== "" && relativePath.startsWith(`${candidate}/`))
  const operations = snapshot?.operations.filter((operation) => operation.bindingId === binding.id && relevant(operation.relativePath)) ?? []
  const conflicts = snapshot?.conflicts.filter((conflict) => conflict.bindingId === binding.id && relevant(conflict.relativePath)) ?? []
  if (binding.status === "error") return { label: "同步出错", detail: binding.lastError || "同步已停止，请查看同步详情。", attention: true }
  if (binding.status === "paused") return { label: "同步已暂停", detail: "同步关系仍保留，暂停期间不会自动同步修改。" }
  if (conflicts.length || (!relation.inherited && binding.status === "conflict")) return { label: "同步有冲突", detail: "存在未解决的版本冲突，请到同步详情中选择保留的版本。", attention: true }
  if (snapshot?.health.connectivity === "offline") return { label: "同步离线", detail: "本机离线，联网后继续同步。" }
  if (snapshot?.health.readOnly) return { label: "同步待登录", detail: "登录后继续同步。" }
  if (binding.status === "initializing") return { label: "同步准备中", detail: "正在比对本机与云盘的内容。" }
  const work = activeWorkOf(operations)
  if (work) return { label: `同步${work.label.replace(/^正在/u, "")}中`, detail: work.currentPath || work.label }
  if (retryOperationOf(operations)) return { label: "同步待重试", detail: "同步暂未完成，稍后自动重试。" }
  return { label: "同步", detail: "本机与云盘的修改会双向同步；删除也会影响另一端。" }
}
