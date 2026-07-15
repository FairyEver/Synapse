import { describe, expect, it } from "vitest"
import {
  buildBulkSkillTrashSummary,
  createBulkSkillUninstallTargets,
  mapBulkSkillUninstallResults,
  type BulkSkillTrashResultItem,
} from "../bulk-skill-trash"
import type { EditorScanSkillCopyItem } from "../editor-copy-source"

function createItem(name: string): EditorScanSkillCopyItem {
  return {
    key: `project:/repo:/source/${name}`,
    name,
    path: `/source/${name}`,
    source: "external",
    preview: name,
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "ClaudeCode/Synapse",
    scope: "project",
    projectName: "Repo",
    projectPath: "/repo",
    trash: { mode: "path" },
  }
}

describe("bulk skill trash helpers", () => {
  it("creates global and project uninstall targets", () => {
    const projectItem = createItem("jenkins")
    const globalItem = { ...createItem("release"), scope: "global" as const }
    const projectItemWithoutRoot = { ...createItem("deploy"), projectPath: undefined }

    expect(createBulkSkillUninstallTargets([
      globalItem,
      projectItem,
      projectItemWithoutRoot,
    ])).toEqual([
      { path: "/source/release", query: { name: "release" } },
      { path: "/source/jenkins", query: { name: "jenkins", searchRootPath: "/repo" } },
      { path: "/source/deploy", query: { name: "deploy", searchRootPath: "/source/deploy" } },
    ])
  })

  it("maps uninstall results by exact path and exposes skipped or missing results as failures", () => {
    const jenkins = createItem("jenkins")
    const release = createItem("release")
    const deploy = createItem("deploy")

    expect(mapBulkSkillUninstallResults([jenkins, release, deploy], {
      results: [
        { path: "/source/release", status: "skipped", error: "正在使用。" },
        { path: "/source/jenkins", status: "trashed", warning: "安装状态刷新失败。" },
      ],
    })).toEqual([
      { item: jenkins, path: "/source/jenkins", status: "trashed", warning: "安装状态刷新失败。" },
      { item: release, message: "正在使用。", status: "failed" },
      { item: deploy, message: "未返回卸载结果。", status: "failed" },
    ])
  })

  it("summarizes trashed and failed results", () => {
    const item = createItem("jenkins")
    const results: BulkSkillTrashResultItem[] = [
      { status: "trashed", item, path: "/source/jenkins" },
      { status: "failed", item, message: "移到废纸篓失败" },
    ]

    expect(buildBulkSkillTrashSummary(results)).toEqual({
      failed: 1,
      total: 2,
      trashed: 1,
    })
  })
})
