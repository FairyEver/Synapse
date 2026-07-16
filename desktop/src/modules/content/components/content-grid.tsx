import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react"
import { useState, type MouseEvent } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getCategoryLabel } from "@/lib/content-categories"
import { resolveDisplayName } from "@/lib/display-name"
import { useRepoProfileMap } from "@/app-shell/identity-context"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import {
  ContentItemBadges,
  ContentItemMeta,
  ContentItemText,
} from "@/modules/content/components/content-item-meta"
import { EditorInstallBadges } from "@/modules/content/components/editor-install-badges"
import { SkillEnvSecretConfigDialog } from "@/modules/content/components/skill-env-secret-config-dialog"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

type ContentGridProps = {
  canManageDeletedItem?: (item: SynapseContentMeta) => boolean
  contentType: SynapseContentType
  isDeletedView: boolean
  items: SynapseContentMeta[]
  busyItemId: string | null
  onInstallDialogOpenChange?: (open: boolean) => void
  onOpenItem: (item: SynapseContentMeta) => void
  onRestoreItem: (item: SynapseContentMeta) => void
  onPurgeItem: (item: SynapseContentMeta, event: MouseEvent<HTMLElement>) => void
}

function getRemainingDays(modifiedAt: string): number {
  const deletedDate = new Date(modifiedAt)
  const expiresAt = deletedDate.getTime() + 90 * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

function isCardActivationKey(key: string): boolean {
  return key === "Enter" || key === " "
}

function DeletedContentCard({
  canManage,
  contentType,
  item,
  onRestore,
  onPurge,
  disabled,
}: {
  canManage: boolean
  contentType: SynapseContentType
  item: SynapseContentMeta
  onRestore: () => void
  onPurge: (event: MouseEvent<HTMLElement>) => void
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
      className="flex items-start gap-2 rounded-lg bg-background px-3 py-3 opacity-60"
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
      {canManage ? <div className="flex shrink-0 items-center gap-1">
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
      </div> : null}
    </div>
  )
}

function ContentListCard({
  contentType,
  item,
  onInstallDialogOpenChange,
  onConfigureSkillEnv,
  onOpen,
}: {
  contentType: SynapseContentType
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
  onConfigureSkillEnv?: (item: SynapseContentMeta<"skill">) => void
  onOpen: () => void
}) {
  const categoryLabel = getCategoryLabel(contentType, item.category)
  const repoProfileMap = useRepoProfileMap()
  const authorLabel = resolveDisplayName(
    item.createdBy,
    repoProfileMap,
    item.createdByDisplayName,
  )

  if (contentType === "skill" && item.type === "skill") {
    return (
      <SkillContentListCard
        authorLabel={authorLabel}
        categoryLabel={categoryLabel}
        item={item}
        onInstallDialogOpenChange={onInstallDialogOpenChange}
        onConfigureSkillEnv={() => onConfigureSkillEnv?.(item)}
        onOpen={onOpen}
      />
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex cursor-pointer flex-col rounded-lg bg-background px-3 py-3 outline-none transition-shadow hover:ring-2 hover:ring-muted-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!isCardActivationKey(event.key)) {
          return
        }

        event.preventDefault()
        onOpen()
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2 text-left">
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
            description={item.usage?.trim() || item.description}
            descriptionTextClassName="text-xs"
            title={item.title}
          />
        </div>
      </div>

      <ContentCardFooter
        item={item}
        onInstallDialogOpenChange={onInstallDialogOpenChange}
      />
    </div>
  )
}

function ContentCardFooter({
  item,
  onInstallDialogOpenChange,
}: {
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
}) {
  return (
    <div
      className="mt-2 flex items-center gap-2"
      onClick={(event) => {
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
    >
      <div className="min-w-0 flex-1">
        <EditorInstallBadges contentId={item.id} />
      </div>
      <div className="shrink-0">
        <ContentActionSplitButton
          item={item}
          onInstallDialogOpenChange={onInstallDialogOpenChange}
        />
      </div>
    </div>
  )
}

async function copySkillName(skillName: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    toast("复制失败")
    return
  }

  try {
    await navigator.clipboard.writeText(skillName)
    toast("Skill 名称已复制到剪贴板")
  } catch {
    toast("复制失败")
  }
}

function SkillNameCopyButton({ skillName }: { skillName: string }) {
  return (
    <button
      type="button"
      className="block max-w-full truncate text-left font-mono text-xs leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label="复制 Skill 名称"
      title="复制 Skill 名称"
      onClick={(event) => {
        event.stopPropagation()
        void copySkillName(skillName)
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
    >
      <span className="truncate">{skillName}</span>
    </button>
  )
}

function SkillContentListCard({
  authorLabel,
  categoryLabel,
  item,
  onInstallDialogOpenChange,
  onConfigureSkillEnv,
  onOpen,
}: {
  authorLabel: string
  categoryLabel: string
  item: SynapseContentMeta<"skill">
  onInstallDialogOpenChange?: (open: boolean) => void
  onConfigureSkillEnv: () => void
  onOpen: () => void
}) {
  const skillName = item.name?.trim()

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex cursor-pointer flex-col rounded-lg bg-background px-3 py-3 outline-none transition-shadow hover:ring-2 hover:ring-muted-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!isCardActivationKey(event.key)) {
          return
        }

        event.preventDefault()
        onOpen()
      }}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 text-left">
          <ContentItemIcon
            contentId={item.id}
            contentType={item.type}
            icon={item.icon}
            iconType={item.iconType}
            iconImage={item.iconImage}
            title={item.title}
            tone={item.iconBg}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="block min-w-0 w-full max-w-full text-left">
            <ContentItemText
              description={item.usage?.trim() || item.description}
              descriptionTextClassName="text-xs"
              title={item.title}
              titleAccessory={item.hasEnv === true ? (
                <Badge asChild variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                  <button
                    type="button"
                    aria-label={`配置 ${item.title} 的环境变量`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onConfigureSkillEnv()
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                    }}
                  >
                    env
                  </button>
                </Badge>
              ) : null}
            />
          </div>

          {skillName ? (
            <div className="mt-0.5">
              <SkillNameCopyButton skillName={skillName} />
            </div>
          ) : null}

          <ContentItemBadges
            author={authorLabel}
            category={categoryLabel}
            className="mt-2"
          />
        </div>
      </div>

      <ContentCardFooter
        item={item}
        onInstallDialogOpenChange={onInstallDialogOpenChange}
      />
    </div>
  )
}

function ContentGrid({
  canManageDeletedItem = () => true,
  contentType,
  isDeletedView,
  items,
  busyItemId,
  onInstallDialogOpenChange,
  onOpenItem,
  onRestoreItem,
  onPurgeItem,
}: ContentGridProps) {
  const [envConfigItem, setEnvConfigItem] = useState<SynapseContentMeta<"skill"> | null>(null)

  if (isDeletedView) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <DeletedContentCard
            key={item.id}
            canManage={canManageDeletedItem(item)}
            contentType={contentType}
            item={item}
            disabled={busyItemId === item.id}
            onRestore={() => onRestoreItem(item)}
            onPurge={(event) => onPurgeItem(item, event)}
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <ContentListCard
            key={item.id}
            contentType={contentType}
            item={item}
            onInstallDialogOpenChange={onInstallDialogOpenChange}
            onConfigureSkillEnv={setEnvConfigItem}
            onOpen={() => onOpenItem(item)}
          />
        ))}
      </div>
      {envConfigItem ? (
        <SkillEnvSecretConfigDialog
          item={envConfigItem}
          onOpenChange={(open) => {
            if (!open) setEnvConfigItem(null)
          }}
        />
      ) : null}
    </>
  )
}

export { ContentGrid }
export type { ContentGridProps }
