import type { ReactNode } from "react"
import { AlertTriangle, LoaderCircle, PackageOpen } from "lucide-react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ContentHistorySelect } from "@/modules/content/components/content-history-select"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"
import type {
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentType,
  SynapseContentViewMode,
} from "@/types/content"

type ContentDetailPanelProps<T extends SynapseContentType> = {
  detail: SynapseContentDetail<T> | null
  displayedVersion: SynapseLoadedContentVersion<T> | null
  emptyDescription: string
  emptyTitle: string
  errorTitle: string
  history: SynapseContentHistoryEntry[]
  isLoading: boolean
  loadingTitle: string
  onSelectedHistoryDirnameChange: (historyDirname: string) => void
  onViewModeChange: (mode: SynapseContentViewMode) => void
  previewError: string | null
  renderVersion: (args: {
    mode: SynapseContentViewMode
    version: SynapseLoadedContentVersion<T>
  }) => ReactNode
  selectedHistoryDirname: string | null
  stateContainerClassName?: string
  toolbarAction?: ReactNode
  viewMode: SynapseContentViewMode
}

function ContentDetailPanel<T extends SynapseContentType>({
  detail,
  displayedVersion,
  emptyDescription,
  emptyTitle,
  errorTitle,
  history,
  isLoading,
  loadingTitle,
  onSelectedHistoryDirnameChange,
  onViewModeChange,
  previewError,
  renderVersion,
  selectedHistoryDirname,
  stateContainerClassName,
  toolbarAction,
  viewMode,
}: ContentDetailPanelProps<T>) {
  if (isLoading && !displayedVersion) {
    return (
      <Empty className={stateContainerClassName ?? "min-h-[360px] rounded-lg border border-border bg-muted/20"}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LoaderCircle className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>{loadingTitle}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  if (displayedVersion) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={viewMode}
            onValueChange={(value) => onViewModeChange(value === "source" ? "source" : "rendered")}
            className="shrink-0 gap-0"
          >
            <TabsList>
              <TabsTrigger value="rendered">预览</TabsTrigger>
              <TabsTrigger value="source">源码</TabsTrigger>
            </TabsList>
          </Tabs>

          {toolbarAction ? <div className="shrink-0">{toolbarAction}</div> : null}

          {selectedHistoryDirname ? (
            <ContentHistorySelect
              className="min-w-0 flex-1"
              history={history}
              latestHistoryDirname={detail?.latestHistoryDirname ?? displayedVersion.historyDirname}
              selectedHistoryDirname={selectedHistoryDirname}
              onSelectedHistoryDirnameChange={onSelectedHistoryDirnameChange}
            />
          ) : null}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          {previewError ? (
            <Empty className={stateContainerClassName ?? "min-h-[360px] rounded-lg border border-border bg-muted/20"}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <AlertTriangle />
                </EmptyMedia>
                <EmptyTitle>{errorTitle}</EmptyTitle>
                <EmptyDescription>{previewError}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            renderVersion({
              mode: viewMode,
              version: displayedVersion,
            })
          )}
        </div>
      </div>
    )
  }

  if (previewError) {
    return (
      <Empty className={stateContainerClassName ?? "min-h-[360px] rounded-lg border border-border bg-muted/20"}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>{errorTitle}</EmptyTitle>
          <EmptyDescription>{previewError}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Empty className={stateContainerClassName ?? "min-h-[360px] rounded-lg border border-border bg-muted/20"}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageOpen />
        </EmptyMedia>
        <EmptyTitle>{emptyTitle}</EmptyTitle>
        <EmptyDescription>{emptyDescription}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export { ContentDetailPanel }
