import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("scan item detail dialog layout", () => {
  it("keeps the preview/source switch outside the dialog header", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )
    const headerStart = source.indexOf("<DialogFrameHeader")
    const headerEnd = source.indexOf("</DialogFrameHeader>", headerStart)
    const headerContent = source.slice(headerStart, headerEnd)

    expect(headerContent).not.toContain("<Tabs")
  })

  it("uses a fixed viewport-height frame for scrollable detail content", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )
    const dialogStart = source.indexOf("<DialogContent")
    const dialogEnd = source.indexOf(">", dialogStart)
    const dialogOpeningTag = source.slice(dialogStart, dialogEnd)

    expect(dialogOpeningTag).toContain("h-[calc(100vh-2rem)]")
    expect(dialogOpeningTag).toContain("overflow-hidden")
    expect(source).toContain("<DialogFrame>")
    expect(source).toContain('<ScrollArea className="mt-4 min-h-0 flex-1">')
  })

  it("uses import wording for external scan items", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("导入到仓库")
    expect(source).toContain("查看仓库内容")
    expect(source).toContain("作为新内容导入")
    expect(source).not.toContain("保存到仓库")
    expect(source).not.toContain("作为新内容保存")
  })

  it("offers editor copy from scan item details", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("复制到其它编辑器")
    expect(source).toContain("<EditorCopyDialog")
  })

  it("groups detail menu actions by destination and risk", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )
    const menuStart = source.indexOf('<DropdownMenuContent align="end" className="min-w-56">')
    const menuEnd = source.indexOf("</DropdownMenuContent>", menuStart)
    const menuSource = source.slice(menuStart, menuEnd)

    expect(menuSource.match(/<DropdownMenuGroup>/g)).toHaveLength(3)
    expect(menuSource.match(/<DropdownMenuSeparator \/>/g)).toHaveLength(2)
    expect(menuSource).toMatch(
      /<DropdownMenuGroup>[\s\S]*\{primaryActionLabel\}[\s\S]*重新安装[\s\S]*发布到仓库[\s\S]*上传到 Skill Repository[\s\S]*<\/DropdownMenuGroup>[\s\S]*<DropdownMenuSeparator \/>[\s\S]*<DropdownMenuGroup>[\s\S]*移到废纸篓[\s\S]*<\/DropdownMenuGroup>[\s\S]*<DropdownMenuSeparator \/>[\s\S]*<DropdownMenuGroup>[\s\S]*复制到其它编辑器[\s\S]*<\/DropdownMenuGroup>/,
    )
  })

  it("uses copy wording for editor copy", async () => {
    const source = await readFile(
      new URL("../components/editor-copy-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("EditorWriteTargetSelector")
    expect(source).toContain("copyToEditor")
    expect(source).toContain("复制到")
    expect(source).toContain("复制失败。")
    expect(source).toContain("复制后会被替换")
    expect(source).toContain("await onCopied?.()")
    expect(source).not.toContain("正在安装到")
    expect(source).not.toContain("安装失败。")
  })

  it("keeps shared editor write target copy wording neutral", async () => {
    const source = await readFile(
      new URL("../../content/components/editor-write-target-selector.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("解析全局复制位置失败。")
    expect(source).toContain("解析项目复制位置失败。")
    expect(source).toContain("复制后会替换旧 Skill")
    expect(source).toContain("不能复制到这个位置")
  })

  it("offers trash only from scan item details", async () => {
    const detailSource = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )
    const cardSource = await readFile(
      new URL("../components/scan-item-card.tsx", import.meta.url),
      "utf8",
    )

    expect(detailSource).toContain("移到废纸篓")
    expect(detailSource).toContain("editor-scan-trash-confirm")
    expect(detailSource).toContain("已移到废纸篓")
    expect(cardSource).not.toContain("移到废纸篓")
    expect(cardSource).not.toContain("Trash2")
  })

  it("warns when trash succeeds but list refresh fails", async () => {
    const detailSource = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(detailSource).toContain("Scan list refresh failed after trash.")
    expect(detailSource).toContain("warning(\"已移到废纸篓，刷新失败\")")
  })

  it("uses the scan trash bridge from the detail dialog", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("bridge.editorScan.trashItem")
    expect(source).toContain("item?.trash.mode === \"unsupported\"")
    expect(source).toContain("item.trash.disabledReason")
  })

  it("delegates Skill uninstall while keeping Rule trash local", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("onRequestSkillUninstall?.(item)")
    expect(source).toMatch(/if \(item\.type === "skill"\) \{[\s\S]*onRequestSkillUninstall\?\.\(item\)[\s\S]*return[\s\S]*\}[\s\S]*setIsTrashConfirmOpen\(true\)/)
    expect(source).toContain('if (!item || item.type !== "rule" || trashDisabledReason) return')
    expect(source).toContain('{item.type === "rule" ? (')
  })

  it("offers a publish-to-repo action for synapse-installed scan items", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("发布到仓库")
    expect(source).toContain("canPublishToRepo")
    expect(source).toContain('item.source === "synapse"')
  })

  it("guards reinstall with the same disabled reason as repository actions", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("if (!item?.synapseContentId || disabledReason) return")
    expect(source).toContain("disabled={isReinstallBusy || disabledReason !== null}")
    expect(source).toContain("}, [disabledReason, item, notifyError])")
  })

  it("asks user to choose between overwrite and publish-as-new", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("覆盖现有内容")
    expect(source).toContain("发布为新内容")
    expect(source).toContain("isPublishChoiceOpen")
  })

  it("dispatches edit-overwrite for the overwrite choice", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("requestOpenContentEditOverwrite")
    expect(source).toContain("prepareQuickPublishDraft")
    expect(source).toContain('kind: "edit-overwrite"')
  })

  it("falls back to publish-as-new when linked content is unavailable on overwrite", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("setFallbackReason")
    expect(source).toContain("handlePublishOverwrite")
  })

  it("does not call catch on an optional showItemInFolder result", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).not.toContain("getSynapseBridge()?.shell.showItemInFolder")
    expect(source).not.toMatch(/bridge\?\.shell\.showItemInFolder\([^)]*\)\.catch/)
  })

  it("offers Skill Repository upload only through the Skill detail action", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("上传到 Skill Repository")
    expect(source).toContain('item.type === "skill"')
    expect(source).toContain("getUploadSkillToSkillRepositoryDisabledReason")
    expect(source).toContain("handleUploadSkillToSkillRepository")
    expect(source).toContain("prepareSkillRepositoryUpload")
    expect(source).toContain("isSkillRepositoryUploadConfirmOpen")
    expect(source).toContain("expectedSourceFingerprint")
  })

  it("opens Synapse after uploading to Skill Repository", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("bridge.editorScan.uploadSkillToSkillRepository")
    expect(source).toContain("buildUploadSkillToSkillRepositoryRequest(item)")
    expect(source).toContain("openSkillRepositoryManagement(result.managementUrl)")
    expect(source).toContain("bridge.shell.openExternal(managementUrl)")
    expect(source).toContain("setSkillRepositoryManagementUrl(managementUrl)")
    expect(source).toContain("复制链接")
  })

  it("offers a local-only retry when Skill Repository identity writing fails", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("bridge.editorScan.retrySkillRepositoryIdentity")
    expect(source).toContain("buildRetrySkillRepositoryIdentityRequest")
    expect(source).toContain("error: result.identityWriteError ?? null")
    expect(source).not.toContain("identityWriteError: result.identityWriteError")
    expect(source).toContain("重试关联")
    expect(source).toContain("本地关联写入失败。")
  })
})
