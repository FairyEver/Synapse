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
      <ModuleSidebarList>
        {categories.map((category) => (
          <ModuleSidebarItem
            key={category.id}
            active={category.id === activeCategory}
            icon={category.icon}
            onClick={() => onCategoryChange(category.id)}
            className="h-10 px-4"
          >
            {category.label}
          </ModuleSidebarItem>
        ))}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { SettingsCategorySidebar }
