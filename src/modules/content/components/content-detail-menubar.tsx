import { Fragment } from "react"
import { Button } from "@/components/ui/button"
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { useContentDownloadActions } from "@/modules/content/hooks/use-content-download-actions"
import type { SynapseContentMeta } from "@/types/content"

type ContentDetailMenubarProps = {
  canEdit: boolean
  canOpenInNewWindow: boolean
  isFavorite: boolean
  isRepositoryInitializing: boolean
  item: SynapseContentMeta
  onDelete: () => void
  onEdit: () => void
  onOpenInNewWindow: () => void
  onToggleFavorite: () => Promise<void>
}

function ContentDetailMenubar({
  canEdit,
  canOpenInNewWindow,
  isFavorite,
  isRepositoryInitializing,
  item,
  onDelete,
  onEdit,
  onOpenInNewWindow,
  onToggleFavorite,
}: ContentDetailMenubarProps) {
  const {
    allMenuSections,
    installDialog,
    loadInstallTargets,
  } = useContentDownloadActions({ item })

  return (
    <>
      <Menubar className="w-fit">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-sm px-1.5"
          disabled={!canEdit}
          onClick={onEdit}
        >
          编辑
        </Button>

        {allMenuSections.length > 0 ? (
          <MenubarMenu>
            <MenubarTrigger
              onFocus={() => {
                loadInstallTargets()
              }}
              onPointerEnter={() => {
                loadInstallTargets()
              }}
            >
              下载
            </MenubarTrigger>
            <MenubarContent className="w-56">
              {allMenuSections.map((section, index) => (
                <Fragment key={section.key}>
                  {section.label ? <MenubarLabel>{section.label}</MenubarLabel> : null}
                  <MenubarGroup>
                    {section.items.map((action) => (
                      <MenubarItem
                        key={action.key}
                        disabled={action.disabled}
                        onSelect={action.onSelect}
                      >
                        {action.label}
                      </MenubarItem>
                    ))}
                  </MenubarGroup>
                  {index < allMenuSections.length - 1 ? <MenubarSeparator /> : null}
                </Fragment>
              ))}
            </MenubarContent>
          </MenubarMenu>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-sm px-1.5"
          disabled={isRepositoryInitializing}
          onClick={onDelete}
        >
          删除
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-sm px-1.5"
          disabled={!canOpenInNewWindow}
          onClick={onOpenInNewWindow}
        >
          新窗口打开
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-sm px-1.5"
          disabled={isRepositoryInitializing}
          onClick={() => {
            void onToggleFavorite()
          }}
        >
          {isFavorite ? "取消收藏" : "收藏"}
        </Button>
      </Menubar>

      {installDialog}
    </>
  )
}

export { ContentDetailMenubar }
