/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createDriveUploadTask, applyDriveUploadProgressEvent, finishDriveUploadTask } from "../drive-upload-task"
import { DriveUploadTaskPanel } from "../drive-upload-task-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("DriveUploadTaskPanel", () => {
  it("shows upload progress and file info without local paths", async () => {
    const task = applyDriveUploadProgressEvent(createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "/专利申请/流式图表解析",
      parentId: "folder-1",
      request: {
        taskId: "upload-task-1",
        parentId: "folder-1",
        items: [
          { kind: "file", path: "/Users/me/Desktop/report.pdf", name: "report.pdf", mimeType: "application/pdf" },
          {
            kind: "folder",
            folderName: "flowcharts",
            files: [
              { path: "/Users/me/Desktop/flowcharts/a.png", relativePath: "a.png", mimeType: "image/png" },
            ],
          },
        ],
      },
      startedAt: 100,
    }), {
      type: "item-completed",
      taskId: "upload-task-1",
      itemKey: "item:0",
    })

    await render(
      <DriveUploadTaskPanel
        task={task}
        open
        onOpenChange={() => undefined}
      />,
    )

    expect(document.body.textContent).toContain("上传任务")
    expect(document.body.textContent).toContain("1 / 3")
    expect(document.body.textContent).toContain("/专利申请/流式图表解析")
    expect(document.body.textContent).toContain("report.pdf")
    expect(document.body.textContent).toContain("flowcharts/a.png")
    expect(document.body.textContent).toContain("application/pdf")
    expect(document.body.textContent).not.toContain("/Users/me/Desktop")
  })

  it("enables retry for failed uploads", async () => {
    const failed = finishDriveUploadTask(applyDriveUploadProgressEvent(createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" }],
      },
      startedAt: 100,
    }), {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "item:0",
      message: "上传失败。",
    }), { completed: 0, failed: 1, skipped: 0, message: "上传失败。" }, 200)
    const onRetry = vi.fn()

    await render(
      <DriveUploadTaskPanel
        task={failed}
        open
        retrying={false}
        onOpenChange={() => undefined}
        onRetry={onRetry}
      />,
    )

    await act(async () => {
      getButton("重试失败项").click()
      await flushPromises()
    })

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("does not enable retry while the upload task is still running", async () => {
    const running = applyDriveUploadProgressEvent(createDriveUploadTask({
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
    }), {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "item:0",
      message: "上传失败。",
    })

    await render(
      <DriveUploadTaskPanel
        task={running}
        open
        onOpenChange={() => undefined}
        onRetry={() => undefined}
      />,
    )

    expect(document.body.textContent).not.toContain("重试失败项")
  })

  it("shows completed empty directories in task progress", async () => {
    const task = finishDriveUploadTask(createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{
          kind: "folder",
          folderName: "project",
          directories: [{ relativePath: "docs" }, { relativePath: "docs/empty" }],
          files: [],
        }],
      },
      startedAt: 100,
    }), { completed: 0, completedDirectories: 3, failed: 0, skipped: 0 }, 200)

    await render(
      <DriveUploadTaskPanel
        task={task}
        open
        onOpenChange={() => undefined}
      />,
    )

    expect(document.body.textContent).toContain("3 / 3")
    expect(document.body.textContent).toContain("已完成3")
  })

  it("enables retry after a directory-only upload preparation failure", async () => {
    const task = finishDriveUploadTask(createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{
          kind: "folder",
          folderName: "project",
          directories: [{ relativePath: "docs" }, { relativePath: "docs/empty" }],
          files: [],
        }],
      },
      startedAt: 100,
    }), { completed: 0, failed: 0, failedDirectories: 3, skipped: 0, message: "上传失败。" }, 200)

    const onRetry = vi.fn()
    await render(
      <DriveUploadTaskPanel
        task={task}
        open
        onOpenChange={() => undefined}
        onRetry={onRetry}
      />,
    )

    expect(document.body.textContent).toContain("上传失败")
    expect(document.body.textContent).toContain("失败3")
    await act(async () => {
      getButton("重试失败项").click()
      await flushPromises()
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("keeps upload status visible when paths are long", async () => {
    const longRelativePath = [
      "very-long-project-name-with-many-segments",
      "nested-output",
      "generated-assets",
      "diagrams",
      "architecture-TIHT7OUA-7b9aecc2.js",
    ].join("/")
    const displayPath = `build/${longRelativePath}`
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "/团队资料/非常长的项目目录/构建产物/代码块/根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [
          {
            kind: "folder",
            folderName: "build",
            files: [{ path: `/tmp/build/${longRelativePath}`, relativePath: longRelativePath, mimeType: "text/javascript" }],
          },
        ],
      },
      startedAt: 100,
    })

    await render(
      <DriveUploadTaskPanel
        task={task}
        open
        onOpenChange={() => undefined}
      />,
    )

    const pathLabel = document.querySelector(`[title="${displayPath}"]`)
    const waitingBadge = Array.from(document.querySelectorAll("[data-slot='badge']")).find((element) => element.textContent === "等待")

    expect(pathLabel?.getAttribute("dir")).toBe("rtl")
    expect(pathLabel?.classList.contains("truncate")).toBe(true)
    expect(pathLabel?.classList.contains("text-left")).toBe(true)
    expect(waitingBadge?.classList.contains("shrink-0")).toBe(true)
  })
})

async function render(element: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(element)
    await flushPromises()
  })
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.includes(name))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return button
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
