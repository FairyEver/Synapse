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
    <ModuleSidebar>
      <ModuleSidebarList>
        {categories.map((category) => (
          <ModuleSidebarItem
            key={category.id}
            active={category.id === activeCategory}
            onClick={() => onCategoryChange(category.id)}
          >
            {category.label}
          </ModuleSidebarItem>
        ))}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { SettingsCategorySidebar }
