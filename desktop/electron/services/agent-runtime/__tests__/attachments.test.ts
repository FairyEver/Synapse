import { describe, expect, it } from "vitest"

import {
  buildAgentRuntimeUserContent,
  directoriesForPathAttachments,
  hasUnconfiguredAttachmentDirectories,
  userMessagePresentationHistoryMetadataFromRefs,
} from "../attachments"
import type { AgentAttachment } from "../types"

describe("agent runtime attachments", () => {
  it.each([1, 4, 20, 50])("builds an ordered runtime path manifest for %i images", (count) => {
    const attachments = Array.from({ length: count }, (_, index) => ({
      kind: "path" as const,
      path: `/controlled/draft/image-${index + 1}/original.png`,
      entryType: "image" as const,
      name: `image-${index + 1}.png`,
    }))

    const content = buildAgentRuntimeUserContent("分析全部图片", attachments)

    expect(content).toContain("[Image #1]")
    expect(content).toContain(`[Image #${count}]`)
    if (count > 1) {
      expect(content.indexOf("[Image #1]")).toBeLessThan(content.indexOf(`[Image #${count}]`))
    }
    expect(content).toContain("分析全部图片")
    expect(content).not.toContain("base64")
  })

  it("keeps mixed attachment order and emits paths only in runtime content", () => {
    const content = buildAgentRuntimeUserContent("请处理", [
      pathAttachment("/controlled/draft/image/original.png", "image"),
      pathAttachment("/controlled/draft/report/original.md", "file"),
      pathAttachment("/Users/liyang/Downloads/sources", "directory"),
    ])

    expect(content).toContain("1. [Image #1]")
    expect(content).toContain("2. [File #1]")
    expect(content).toContain("3. [Directory #1]")
  })

  it("persists opaque attachment references for non-image history actions", () => {
    const metadata = userMessagePresentationHistoryMetadataFromRefs({
      content: "",
      projectId: "project-1",
      sessionKey: "session-1",
      platform: "claude",
    }, [{
      version: 2,
      attachmentId: "attachment-1",
      kind: "file",
      name: "report.md",
      byteSize: 7,
      sha256: "a".repeat(64),
    }])

    expect(metadata).toMatchObject({
      attachments: [{
        path: "synapse-agent-attachment://local/attachment-1",
        name: "report.md",
      }],
    })
    expect(JSON.stringify(metadata)).not.toContain("/controlled/")
  })

  it("skips POSIX cwd-internal path attachments", () => {
    expect(directoriesForPathAttachments({
      cwd: "/Users/liyang/project",
      attachments: [
        pathAttachment("/Users/liyang/project/README.md", "file"),
        pathAttachment("/Users/liyang/project/docs", "directory"),
      ],
    })).toEqual([])
  })

  it("maps POSIX external files to parent dirs and directories to themselves", () => {
    expect(directoriesForPathAttachments({
      cwd: "/Users/liyang/project",
      attachments: [
        pathAttachment("/Users/liyang/Desktop/report.pdf", "file"),
        pathAttachment("/Users/liyang/Downloads/sources", "directory"),
      ],
    })).toEqual([
      "/Users/liyang/Desktop",
      "/Users/liyang/Downloads/sources",
    ])
  })

  it("treats configured POSIX parents as allowing children while blocking siblings", () => {
    expect(hasUnconfiguredAttachmentDirectories({
      cwd: "/Users/liyang/project",
      configuredDirectories: ["/Users/liyang/Desktop"],
      attachments: [pathAttachment("/Users/liyang/Desktop/nested/report.pdf", "file")],
    })).toBe(false)
    expect(hasUnconfiguredAttachmentDirectories({
      cwd: "/Users/liyang/project",
      configuredDirectories: ["/Users/liyang/Desktop/nested"],
      attachments: [pathAttachment("/Users/liyang/Desktop/other/report.pdf", "file")],
    })).toBe(true)
  })

  it("collapses duplicate POSIX parent and child directories", () => {
    expect(directoriesForPathAttachments({
      cwd: "/Users/liyang/project",
      attachments: [
        pathAttachment("/Users/liyang/Desktop/nested/report.pdf", "file"),
        pathAttachment("/Users/liyang/Desktop", "directory"),
        pathAttachment("/Users/liyang/Desktop/nested", "directory"),
      ],
    })).toEqual(["/Users/liyang/Desktop"])
  })

  it("handles Windows drive cwd-internal and external paths deterministically on POSIX", () => {
    expect(directoriesForPathAttachments({
      cwd: "C:\\Users\\liyang\\project",
      attachments: [
        pathAttachment("C:\\Users\\liyang\\project\\README.md", "file"),
        pathAttachment("C:/Users/liyang/Desktop/report.pdf", "file"),
        pathAttachment("D:\\Data\\sources", "directory"),
      ],
    })).toEqual([
      "C:\\Users\\liyang\\Desktop",
      "D:\\Data\\sources",
    ])
  })

  it("handles Windows UNC paths and keeps share-relative dirs", () => {
    expect(directoriesForPathAttachments({
      cwd: "\\\\server\\share\\project",
      attachments: [
        pathAttachment("\\\\server\\share\\project\\inside.md", "file"),
        pathAttachment("\\\\server\\share\\docs\\guide.md", "file"),
        pathAttachment("\\\\server\\share\\assets", "directory"),
      ],
    })).toEqual([
      "\\\\server\\share\\docs",
      "\\\\server\\share\\assets",
    ])
  })

  it("handles forward-slash Windows UNC paths as win32 paths", () => {
    expect(directoriesForPathAttachments({
      cwd: "//server/share/project",
      attachments: [
        pathAttachment("//server/share/project/inside.md", "file"),
        pathAttachment("//server/share/docs/report.md", "file"),
      ],
    })).toEqual(["\\\\server\\share\\docs"])
    expect(hasUnconfiguredAttachmentDirectories({
      cwd: "//server/share/project",
      configuredDirectories: ["\\\\server\\share\\docs"],
      attachments: [pathAttachment("//server/share/docs/nested/report.md", "file")],
    })).toBe(false)
    expect(hasUnconfiguredAttachmentDirectories({
      cwd: "//server/share/project",
      configuredDirectories: ["\\\\server\\share\\docs\\nested"],
      attachments: [pathAttachment("//server/share/docs/sibling/report.md", "file")],
    })).toBe(true)
  })

  it("does not compare paths across flavors as contained", () => {
    expect(directoriesForPathAttachments({
      cwd: "/Users/liyang/project",
      attachments: [pathAttachment("C:\\Users\\liyang\\project\\README.md", "file")],
    })).toEqual(["C:\\Users\\liyang\\project"])
  })
})

function pathAttachment(
  path: string,
  entryType: "image" | "file" | "directory",
): AgentAttachment {
  return {
    kind: "path",
    path,
    entryType,
  }
}
