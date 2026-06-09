import { describe, expect, it } from "vitest"

import {
  buildClaudeUserMessageContent,
  directoriesForPathAttachments,
  hasUnconfiguredAttachmentDirectories,
} from "../attachments"
import type { AgentAttachment } from "../types"

describe("agent runtime attachments", () => {
  it("builds SDK image blocks before readable text", () => {
    expect(buildClaudeUserMessageContent("[Image #1]\nhello", [{
      kind: "image",
      mimeType: "image/png",
      data: new Uint8Array([1, 2, 3]),
    }])).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "AQID",
        },
      },
      { type: "text", text: "[Image #1]\nhello" },
    ])
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
  entryType: "file" | "directory",
): AgentAttachment {
  return {
    kind: "path",
    path,
    entryType,
  }
}
