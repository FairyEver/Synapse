import { useEffect } from "react"
import { ContentDetailPanel } from "@/modules/content/components/content-detail-panel"
import { useContentDetailState } from "@/modules/content/hooks/use-content-detail-state"
import { RuleVersionView } from "@/modules/rules/components/rule-version-view"
import { SkillVersionView } from "@/modules/skills/components/skill-version-view"
import type { SynapseContentWindowRequest } from "@/types/content"

type ContentDetailWindowPageProps = {
  request: SynapseContentWindowRequest
}

function RuleDetailWindowPage({
  request,
}: {
  request: SynapseContentWindowRequest
}) {
  const detailState = useContentDetailState<"rule">({
    initialHistoryDirname: request.historyDirname ?? null,
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是规则。",
    item: {
      id: request.id,
      type: "rule",
    },
    loadDetailErrorMessage: "读取规则详情失败。",
    loadHistoryErrorMessage: "读取规则历史失败。",
    logCategory: "rules.detail.window",
    open: true,
  })

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background p-4">
      <ContentDetailPanel
        detail={detailState.detail}
        displayedVersion={detailState.displayedVersion}
        emptyDescription="它可能已经被删除。"
        emptyTitle="找不到这条规则"
        errorTitle="无法显示规则"
        history={detailState.historyEntries}
        isLoading={detailState.isLoading}
        loadingTitle="正在读取规则"
        onSelectedHistoryDirnameChange={detailState.setSelectedHistoryDirname}
        onViewModeChange={detailState.setViewMode}
        previewError={detailState.previewError}
        renderVersion={({ mode, version }) => (
          <RuleVersionView mode={mode} version={version} />
        )}
        selectedHistoryDirname={detailState.selectedHistoryDirname}
        stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
        viewMode={detailState.viewMode}
      />
    </div>
  )
}

function SkillDetailWindowPage({
  request,
}: {
  request: SynapseContentWindowRequest
}) {
  const detailState = useContentDetailState<"skill">({
    initialHistoryDirname: request.historyDirname ?? null,
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是 Skill。",
    item: {
      id: request.id,
      type: "skill",
    },
    loadDetailErrorMessage: "读取 Skill 详情失败。",
    loadHistoryErrorMessage: "读取 Skill 历史失败。",
    logCategory: "skills.detail.window",
    open: true,
  })

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background p-4">
      <ContentDetailPanel
        detail={detailState.detail}
        displayedVersion={detailState.displayedVersion}
        emptyDescription="它可能已经被删除。"
        emptyTitle="找不到这条 Skill"
        errorTitle="无法显示 Skill"
        history={detailState.historyEntries}
        isLoading={detailState.isLoading}
        loadingTitle="正在读取 Skill"
        onSelectedHistoryDirnameChange={detailState.setSelectedHistoryDirname}
        onViewModeChange={detailState.setViewMode}
        previewError={detailState.previewError}
        renderVersion={({ mode, version }) => (
          <SkillVersionView mode={mode} version={version} />
        )}
        selectedHistoryDirname={detailState.selectedHistoryDirname}
        stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
        viewMode={detailState.viewMode}
      />
    </div>
  )
}

function ContentDetailWindowPage({ request }: ContentDetailWindowPageProps) {
  if (request.contentType === "rule") {
    return <RuleDetailWindowPage request={request} />
  }

  return <SkillDetailWindowPage request={request} />
}

export { ContentDetailWindowPage }
