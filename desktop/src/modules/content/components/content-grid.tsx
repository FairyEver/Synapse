import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getCategoryLabel } from "@/lib/content-categories"
import { resolveDisplayName } from "@/lib/display-name"
import { useRepoProfileMap } from "@/app-shell/identity-context"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import { ContentItemMeta } from "@/modules/content/components/content-item-meta"
import { EditorInstallBadges } from "@/modules/content/components/editor-install-badges"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

type ContentGridProps = {
  contentType: SynapseContentType
  isDeletedView: boolean
  items: SynapseContentMeta[]
  busyItemId: string | null
  onInstallDialogOpenChange?: (open: boolean) => void
  onOpenItem: (item: SynapseContentMeta) => void
  onRestoreItem: (item: SynapseContentMeta) => void
  onPurgeItem: (item: SynapseContentMeta) => void
}

function getRemainingDays(modifiedAt: string): number {
  const deletedDate = new Date(modifiedAt)
  const expiresAt = deletedDate.getTime() + 90 * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

function DeletedContentCard({
  contentType,
  item,
  onRestore,
  onPurge,
  disabled,
}: {
  contentType: SynapseContentType
  item: SynapseContentMeta
  onRestore: () => void
  onPurge: () => void
  disabled?: boolean
}) {
  const repoProfileMap = useRepoProfileMap()
  const deletedByLabel = resolveDisplayName(
    item.modifiedBy,
    repoProfileMap,
    item.modifiedByDisplayName,
  )
  const remainingDays = getRemainingDays(item.modifiedAt)

  return (
    <div
      className="flex items-start gap-3 rounded-lg bg-background px-3 py-3 opacity-60"
    >
      <ContentItemIcon
        contentId={item.id}
        contentType={contentType}
        icon={item.icon}
        iconType={item.iconType}
        iconImage={item.iconImage}
        title={item.title}
        tone={item.iconBg}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          还剩 {remainingDays} 天 · 由 {deletedByLabel} 删除
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title="恢复"
          disabled={disabled}
          onClick={onRestore}
        >
          {disabled
            ? <LoaderCircle className="size-4 animate-spin" />
            : <RotateCcw className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          title="永久删除"
          disabled={disabled}
          onClick={onPurge}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function ContentListCard({
  contentType,
  item,
  onInstallDialogOpenChange,
  onOpen,
}: {
  contentType: SynapseContentType
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
  onOpen: () => void
}) {
  const categoryLabel = getCategoryLabel(contentType, item.category)
  const repoProfileMap = useRepoProfileMap()
  const authorLabel = resolveDisplayName(
    item.createdBy,
    repoProfileMap,
    item.createdByDisplayName,
  )

  return (
    <div
      className="flex flex-col rounded-lg bg-background px-3 py-3 transition-shadow hover:ring-2 hover:ring-muted-foreground/25"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onOpen}
        >
          <ContentItemIcon
            contentId={item.id}
            contentType={contentType}
            icon={item.icon}
            iconType={item.iconType}
            iconImage={item.iconImage}
            title={item.title}
            tone={item.iconBg}
          />
          <ContentItemMeta
            author={authorLabel}
            category={categoryLabel}
            className="flex-1"
            description={item.description}
            title={item.title}
          />
        </button>

        <div
          className="shrink-0 self-start"
          onClick={(event) => {
            event.stopPropagation()
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
          }}
        >
          <ContentActionSplitButton
            item={item}
            onInstallDialogOpenChange={onInstallDialogOpenChange}
          />
        </div>
      </div>

      <EditorInstallBadges contentId={item.id} />
    </div>
  )
}

function ContentGrid({
  contentType,
  isDeletedView,
  items,
  busyItemId,
  onInstallDialogOpenChange,
  onOpenItem,
  onRestoreItem,
  onPurgeItem,
}: ContentGridProps) {
  if (isDeletedView) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <DeletedContentCard
            key={item.id}
            contentType={contentType}
            item={item}
            disabled={busyItemId === item.id}
            onRestore={() => onRestoreItem(item)}
            onPurge={() => onPurgeItem(item)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <ContentListCard
          key={item.id}
          contentType={contentType}
          item={item}
          onInstallDialogOpenChange={onInstallDialogOpenChange}
          onOpen={() => onOpenItem(item)}
        />
      ))}
    </div>
  )
}

export { ContentGrid }
export type { ContentGridProps }
