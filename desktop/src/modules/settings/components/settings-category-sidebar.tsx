import {
  ModuleSidebar,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import type { SettingsCategory, SettingsCategoryId } from "@/modules/settings/types"

type SettingsCategorySidebarProps = {
  categories: SettingsCategory[]
  activeCategory: SettingsCategoryId
  onCategoryChange: (category: SettingsCategoryId) => void
}

function SettingsCategorySidebar({
  categories,
  activeCategory,
  onCategoryChange,
}: SettingsCategorySidebarProps) {
  return (
    <ModuleSidebar variant="bare">
      <ModuleSidebarList data-track="settings-category-list">
        {categories.map((category) => (
          <ModuleSidebarItem
            key={category.id}
            active={category.id === activeCategory}
            icon={category.icon}
            data-track="settings-category-select"
            trackValue={category.id}
            onClick={() => onCategoryChange(category.id)}
            className="h-8 px-4 font-normal"
          >
            {category.label}
          </ModuleSidebarItem>
        ))}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { SettingsCategorySidebar }
