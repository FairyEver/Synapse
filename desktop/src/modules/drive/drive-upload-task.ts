import type {
  DriveLocalUploadFileItem,
  DriveLocalUploadFolderItem,
  DriveLocalUploadItem,
  DriveLocalUploadProgressEvent,
  DriveLocalUploadRequest,
  DriveLocalUploadResult,
} from "@/types/bridge"

export type DriveUploadTaskStatus = "running" | "completed" | "failed"
export type DriveUploadTaskItemStatus = "queued" | "preparing" | "uploading" | "completed" | "skipped" | "failed"

export type DriveUploadTaskItem = {
  readonly key: string
  readonly name: string
  readonly relativePath: string | null
  readonly localPath: string
  readonly mimeType: string | null
  readonly status: DriveUploadTaskItemStatus
  readonly uploadedBytes: number | null
  readonly totalBytes: number | null
  readonly message: string | null
  readonly sourceItem: DriveLocalUploadItem
}

export type DriveUploadTask = {
  readonly id: string
  readonly parentId: string | null
  readonly destinationPath: string
  readonly status: DriveUploadTaskStatus
  readonly totalItems: number
  readonly completedItems: number
  readonly failedItems: number
  readonly skippedItems: number
  readonly items: readonly DriveUploadTaskItem[]
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly message: string | null
}

export type CreateDriveUploadTaskInput = {
  readonly id: string
  readonly parentId: string | null
  readonly destinationPath: string
  readonly request: DriveLocalUploadRequest
  readonly startedAt?: number
}

export function createDriveUploadTask(input: CreateDriveUploadTaskInput): DriveUploadTask {
  const items = input.request.items.flatMap((item, itemIndex) => flattenUploadItem(item, itemIndex))
  const totalDirectories = input.request.items.reduce(
    (total, item) => total + (item.kind === "folder" ? 1 + (item.directories?.length ?? 0) : 0),
    0,
  )
  return withCounts({
    id: input.id,
    parentId: input.parentId,
    destinationPath: input.destinationPath,
    status: "running",
    totalItems: items.length + totalDirectories,
    completedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    items,
    startedAt: input.startedAt ?? Date.now(),
    finishedAt: null,
    message: null,
  })
}

export function applyDriveUploadProgressEvent(
  task: DriveUploadTask,
  event: DriveLocalUploadProgressEvent,
): DriveUploadTask {
  if (event.taskId !== task.id) return task
  if (event.type === "task-finished") return finishDriveUploadTask(task, event.result)

  const itemIndex = task.items.findIndex((item) => item.key === event.itemKey)
  const item = task.items[itemIndex]
  if (itemIndex < 0 || !item) return task

  const items = [...task.items]
  items[itemIndex] = {
    ...item,
    status: itemStatusFromEvent(event),
    uploadedBytes: event.type === "item-progress" ? event.uploadedBytes : item.uploadedBytes,
    totalBytes: event.type === "item-progress" ? event.totalBytes : item.totalBytes,
    message: "message" in event ? event.message ?? null : null,
  }
  const nextTask = {
    ...task,
    items,
  }
  return event.type === "item-started" || event.type === "item-progress"
    ? nextTask
    : withCounts(nextTask)
}

export function finishDriveUploadTask(
  task: DriveUploadTask,
  result: DriveLocalUploadResult,
  finishedAt = Date.now(),
): DriveUploadTask {
  const reconciled = withCounts({
    ...task,
    status: result.failed > 0 ? "failed" : "completed",
    finishedAt,
    message: result.message ?? null,
  })
  return {
    ...reconciled,
    completedItems: Math.max(reconciled.completedItems, result.completed + (result.completedDirectories ?? 0)),
    failedItems: Math.max(reconciled.failedItems, result.failed),
    skippedItems: Math.max(reconciled.skippedItems, result.skipped),
  }
}

export function failDriveUploadTask(
  task: DriveUploadTask,
  message: string,
  finishedAt = Date.now(),
): DriveUploadTask {
  return withCounts({
    ...task,
    status: "failed",
    finishedAt,
    message,
    items: task.items.map((item) => (
      item.status === "completed" || item.status === "skipped"
        ? item
        : { ...item, status: "failed", message }
    )),
  })
}

export function buildDriveUploadRetryRequest(task: DriveUploadTask): DriveLocalUploadRequest | null {
  const failedItems = task.items.filter((item) => item.status === "failed")
  if (failedItems.length === 0) return null
  const items: DriveLocalUploadItem[] = []
  const folders = new Map<string, { readonly index: number; readonly item: DriveLocalUploadFolderItem }>()
  for (const failedItem of failedItems) {
    const sourceItem = failedItem.sourceItem
    if (sourceItem.kind === "file") {
      items.push(sourceItem)
      continue
    }
    const folder = folders.get(sourceItem.folderName)
    if (!folder) {
      folders.set(sourceItem.folderName, { index: items.length, item: sourceItem })
      items.push(sourceItem)
      continue
    }
    const mergedFolder = {
      ...folder.item,
      files: [...folder.item.files, ...sourceItem.files],
    }
    folders.set(sourceItem.folderName, { index: folder.index, item: mergedFolder })
    items[folder.index] = mergedFolder
  }
  return {
    parentId: task.parentId,
    items,
  }
}

export function getDriveUploadStatusBadge(task: DriveUploadTask | null): {
  readonly label: string
  readonly tone: "neutral" | "destructive"
  readonly ariaLabel: string
} | null {
  if (!task) return null
  if (task.status === "running") {
    const label = `正在上传 ${task.totalItems} 项`
    return { label, tone: "neutral", ariaLabel: label }
  }
  if (task.status === "failed") {
    const label = task.failedItems > 0 ? `上传失败 ${task.failedItems} 项` : "上传失败"
    return { label, tone: "destructive", ariaLabel: label }
  }
  const label = `已上传 ${task.completedItems} 项`
  return { label, tone: "neutral", ariaLabel: label }
}

function flattenUploadItem(item: DriveLocalUploadItem, itemIndex: number): DriveUploadTaskItem[] {
  if (item.kind === "file") return [taskItemFromFile(item, itemIndex)]
  return item.files.map((file, fileIndex) => taskItemFromFolderFile(item, file, itemIndex, fileIndex))
}

function taskItemFromFile(item: DriveLocalUploadFileItem, itemIndex: number): DriveUploadTaskItem {
  return {
    key: driveLocalUploadItemKey(itemIndex),
    name: item.name,
    relativePath: null,
    localPath: item.path,
    mimeType: item.mimeType ?? null,
    status: "queued",
    uploadedBytes: null,
    totalBytes: null,
    message: null,
    sourceItem: item,
  }
}

function taskItemFromFolderFile(
  folder: DriveLocalUploadFolderItem,
  file: DriveLocalUploadFolderItem["files"][number],
  itemIndex: number,
  fileIndex: number,
): DriveUploadTaskItem {
  const name = file.relativePath.split("/").filter(Boolean).at(-1) ?? file.relativePath
  return {
    key: driveLocalUploadItemKey(itemIndex, fileIndex),
    name,
    relativePath: `${folder.folderName}/${file.relativePath}`,
    localPath: file.path,
    mimeType: file.mimeType ?? null,
    status: "queued",
    uploadedBytes: null,
    totalBytes: null,
    message: null,
    sourceItem: {
      kind: "folder",
      folderName: folder.folderName,
      ...(folder.directories ? { directories: folder.directories } : {}),
      files: [file],
    },
  }
}

function driveLocalUploadItemKey(itemIndex: number, fileIndex?: number): string {
  return fileIndex === undefined ? `item:${itemIndex}` : `item:${itemIndex}:${fileIndex}`
}

function itemStatusFromEvent(event: Exclude<DriveLocalUploadProgressEvent, { readonly type: "task-finished" }>): DriveUploadTaskItemStatus {
  if (event.type === "item-started") return "uploading"
  if (event.type === "item-progress") return "uploading"
  if (event.type === "item-completed") return "completed"
  if (event.type === "item-skipped") return "skipped"
  return "failed"
}

function withCounts(task: DriveUploadTask): DriveUploadTask {
  const completedItems = task.items.filter((item) => item.status === "completed").length
  const failedItems = task.items.filter((item) => item.status === "failed").length
  const skippedItems = task.items.filter((item) => item.status === "skipped").length
  return { ...task, completedItems, failedItems, skippedItems }
}
