import { describe, expect, it } from "vitest"
import {
  applyDriveUploadProgressEvent,
  buildDriveUploadRetryRequest,
  createDriveUploadTask,
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

    expect(task.totalItems).toBe(3)
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
})
