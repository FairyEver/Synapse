import {
  ModuleSidebar,
  ModuleSidebarHeader,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import { Separator } from "@/components/ui/separator"
import type { SynapseCategoryViewItem } from "@/types/category"
import {
  SYNAPSE_DELETED_CATEGORY_ID,
  SYNAPSE_FAVORITES_CATEGORY_ID,
  SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID,
} from "@/lib/content-categories"

type ContentFilterSidebarProps = {
  activeCategoryId: string
  addDisabled: boolean
  addTitle: string
  canBrowseContent: boolean
  categories: SynapseCategoryViewItem[]
  deletedCount: number
  favoriteCount: number
  onActiveCategoryChange: (id: string) => void
  onAddClick: () => void
  onSearchChange: (value: string) => void
  recentlyViewedCount: number
  searchDisabled: boolean
  searchPlaceholder: string
  searchValue: string
}

function ContentFilterSidebar({
  activeCategoryId,
  addDisabled,
  addTitle,
  canBrowseContent,
  categories,
  deletedCount,
  favoriteCount,
  onActiveCategoryChange,
  onAddClick,
  onSearchChange,
  recentlyViewedCount,
  searchDisabled,
  searchPlaceholder,
  searchValue,
}: ContentFilterSidebarProps) {
  return (
    <ModuleSidebar variant="bare">
      <ModuleSidebarHeader
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        searchDisabled={searchDisabled}
        onAddClick={onAddClick}
        addDisabled={addDisabled}
        addTitle={addTitle}
      />
      <ModuleSidebarList>
        {/* 全部分类 */}
        {categories[0] && (
          <ModuleSidebarItem
            key={categories[0].id}
            active={categories[0].id === activeCategoryId}
            disabled={!canBrowseContent}
            onClick={() => onActiveCategoryChange(categories[0].id)}
            className="h-8 px-4"
            trailing={
              <span className="text-xs tabular-nums text-muted-foreground">
                {categories[0].count}
              </span>
            }
          >
            {categories[0].label}
          </ModuleSidebarItem>
        )}

        {/* 我的收藏 */}
        <ModuleSidebarItem
          active={activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID}
          disabled={!canBrowseContent}
          onClick={() => onActiveCategoryChange(SYNAPSE_FAVORITES_CATEGORY_ID)}
          className="h-8 px-4"
          trailing={
            <span className="text-xs tabular-nums text-muted-foreground">
              {favoriteCount}
            </span>
          }
        >
          我的收藏
        </ModuleSidebarItem>

        {/* 最近浏览 */}
        <ModuleSidebarItem
          active={activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID}
          disabled={!canBrowseContent}
          onClick={() => onActiveCategoryChange(SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID)}
          className="h-8 px-4"
          trailing={
            <span className="text-xs tabular-nums text-muted-foreground">
              {recentlyViewedCount}
            </span>
          }
        >
          最近浏览
        </ModuleSidebarItem>

        {/* 分类分隔符 */}
        <Separator className="my-2 bg-border/50" />

        {/* 其余分类 */}
        {categories.slice(1).map((category) => (
          <ModuleSidebarItem
            key={category.id}
            active={category.id === activeCategoryId}
            disabled={!canBrowseContent}
            onClick={() => onActiveCategoryChange(category.id)}
            className="h-8 px-4"
            trailing={
              <span className="text-xs tabular-nums text-muted-foreground">
                {category.count}
              </span>
            }
          >
            {category.label}
          </ModuleSidebarItem>
        ))}

        {/* 最近删除分隔符 */}
        <Separator className="my-2 bg-border/50" />

        {/* 最近删除 */}
        <ModuleSidebarItem
          active={activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID}
          disabled={!canBrowseContent}
          onClick={() => onActiveCategoryChange(SYNAPSE_DELETED_CATEGORY_ID)}
          className="h-8 px-4"
          trailing={
            <span className="text-xs tabular-nums text-muted-foreground">
              {deletedCount}
            </span>
          }
        >
          最近删除
        </ModuleSidebarItem>
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { ContentFilterSidebar }
export type { ContentFilterSidebarProps }
