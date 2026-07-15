import { describe, expect, it } from "vitest"
import {
  applyDriveUploadProgressEvent,
  buildDriveUploadRetryRequest,
  createDriveUploadTask,
  failDriveUploadTask,
  finishDriveUploadTask,
  getDriveUploadStatusBadge,
} from "../drive-upload-task"
import type { DriveLocalUploadRequest } from "@/types/bridge"

describe("drive upload task model", () => {
  it("flattens files and folder entries without exposing raw paths as labels", () => {
    const request: DriveLocalUploadRequest = {
      taskId: "upload-task-1",
      parentId: "folder-1",
      items: [
        { kind: "file", path: "/Users/me/Desktop/report.pdf", name: "report.pdf", mimeType: "application/pdf" },
        {
          kind: "folder",
          folderName: "flowcharts",
          files: [
            { path: "/Users/me/Desktop/flowcharts/a.png", relativePath: "a.png", mimeType: "image/png" },
            { path: "/Users/me/Desktop/flowcharts/docs/b.md", relativePath: "docs/b.md", mimeType: "text/markdown" },
          ],
        },
      ],
    }

    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "/专利申请/流式图表解析",
      parentId: "folder-1",
      request,
      startedAt: 100,
    })

    expect(task.totalItems).toBe(4)
    expect(task.destinationPath).toBe("/专利申请/流式图表解析")
    expect(task.items.map((item) => item.name)).toEqual(["report.pdf", "a.png", "b.md"])
    expect(task.items.map((item) => item.relativePath)).toEqual([null, "flowcharts/a.png", "flowcharts/docs/b.md"])
    expect(task.items.map((item) => item.localPath)).toEqual([
      "/Users/me/Desktop/report.pdf",
      "/Users/me/Desktop/flowcharts/a.png",
      "/Users/me/Desktop/flowcharts/docs/b.md",
    ])
    expect(task.items.every((item) => item.status === "queued")).toBe(true)
  })

  it("updates counts when progress events arrive", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [
          { kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" },
          { kind: "file", path: "/tmp/b.txt", name: "b.txt", mimeType: "text/plain" },
        ],
      },
      startedAt: 100,
    })

    const started = applyDriveUploadProgressEvent(task, {
      type: "item-started",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/a.txt",
    })
    const completed = applyDriveUploadProgressEvent(started, {
      type: "item-completed",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/a.txt",
    })
    const failed = applyDriveUploadProgressEvent(completed, {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/b.txt",
      message: "上传失败。",
    })

    expect(failed.completedItems).toBe(1)
    expect(failed.failedItems).toBe(1)
    expect(failed.items.map((item) => item.status)).toEqual(["completed", "failed"])
    expect(failed.items[1]?.message).toBe("上传失败。")
  })

  it("tracks byte progress for the active upload without completing the item", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" }],
      },
      startedAt: 100,
    })

    const updated = applyDriveUploadProgressEvent(task, {
      type: "item-progress",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/a.txt",
      uploadedBytes: 3,
      totalBytes: 6,
    })

    expect(updated.completedItems).toBe(0)
    expect(updated.items[0]).toMatchObject({
      status: "uploading",
      uploadedBytes: 3,
      totalBytes: 6,
    })
  })

  it("keeps the task reference when progress targets an unknown item", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" }],
      },
      startedAt: 100,
    })

    const updated = applyDriveUploadProgressEvent(task, {
      type: "item-progress",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/missing.txt",
      uploadedBytes: 3,
      totalBytes: 6,
    })

    expect(updated).toBe(task)
  })

  it("counts completed empty directories in folder upload tasks", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{
          kind: "folder",
          folderName: "project",
          directories: [
            { relativePath: "docs" },
            { relativePath: "docs/empty" },
            { relativePath: "assets" },
          ],
          files: [],
        }],
      },
      startedAt: 100,
    })
    const finished = finishDriveUploadTask(task, {
      completed: 0,
      completedDirectories: 4,
      failed: 0,
      skipped: 0,
    }, 200)

    expect(task.totalItems).toBe(4)
    expect(finished.completedItems).toBe(4)
    expect(getDriveUploadStatusBadge(finished)?.label).toBe("已上传 4 项")
  })

  it("retries only failed items against the original parent id", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: "folder-1",
      request: {
        taskId: "upload-task-1",
        parentId: "folder-1",
        items: [
          { kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" },
          { kind: "file", path: "/tmp/b.txt", name: "b.txt", mimeType: "text/plain" },
        ],
      },
      startedAt: 100,
    })
    const failed = applyDriveUploadProgressEvent(task, {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/b.txt",
      message: "上传失败。",
    })

    expect(buildDriveUploadRetryRequest(failed)).toEqual({
      parentId: "folder-1",
      items: [{ kind: "file", path: "/tmp/b.txt", name: "b.txt", mimeType: "text/plain" }],
    })
  })

  it("preserves folder structure when retrying failed folder files", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: "folder-1",
      request: {
        taskId: "upload-task-1",
        parentId: "folder-1",
        items: [{
          kind: "folder",
          folderName: "project",
          directories: [{ relativePath: "docs" }, { relativePath: "empty" }],
          files: [
            { path: "/tmp/project/a.txt", relativePath: "a.txt", mimeType: "text/plain" },
            { path: "/tmp/project/docs/b.txt", relativePath: "docs/b.txt", mimeType: "text/plain" },
          ],
        }],
      },
      startedAt: 100,
    })
    const firstFailed = applyDriveUploadProgressEvent(task, {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "folder:project/a.txt",
      message: "上传失败。",
    })
    const bothFailed = applyDriveUploadProgressEvent(firstFailed, {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "folder:project/docs/b.txt",
      message: "上传失败。",
    })

    expect(buildDriveUploadRetryRequest(bothFailed)).toEqual({
      parentId: "folder-1",
      items: [{
        kind: "folder",
        folderName: "project",
        directories: [{ relativePath: "docs" }, { relativePath: "empty" }],
        files: [
          { path: "/tmp/project/a.txt", relativePath: "a.txt", mimeType: "text/plain" },
          { path: "/tmp/project/docs/b.txt", relativePath: "docs/b.txt", mimeType: "text/plain" },
        ],
      }],
    })
  })

  it("derives status badge copy from active and finished tasks", () => {
    const running = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" }],
      },
      startedAt: 100,
    })
    const finished = finishDriveUploadTask(running, { completed: 1, failed: 0, skipped: 0 }, 200)
    const failed = finishDriveUploadTask(running, { completed: 0, failed: 1, skipped: 0, message: "上传失败。" }, 200)

    expect(getDriveUploadStatusBadge(running)?.label).toBe("正在上传 1 项")
    expect(getDriveUploadStatusBadge(finished)?.label).toBe("已上传 1 项")
    expect(getDriveUploadStatusBadge(failed)).toMatchObject({ label: "上传失败 1 项", tone: "destructive" })
    expect(getDriveUploadStatusBadge(null)).toBeNull()
  })

  it("marks unfinished items as failed when upload setup rejects", () => {
    const running = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" }],
      },
      startedAt: 100,
    })

    const failed = failDriveUploadTask(running, "没有本地文件读取权限。", 200)

    expect(failed).toMatchObject({
      status: "failed",
      failedItems: 1,
      finishedAt: 200,
      message: "没有本地文件读取权限。",
    })
    expect(failed.items[0]).toMatchObject({
      status: "failed",
      message: "没有本地文件读取权限。",
    })
    expect(getDriveUploadStatusBadge(failed)).toMatchObject({
      label: "上传失败 1 项",
      tone: "destructive",
    })
  })
})
