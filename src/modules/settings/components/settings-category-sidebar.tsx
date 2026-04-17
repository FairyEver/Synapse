import { Button } from "@/components/ui/button"
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
    <aside className="w-56 shrink-0 border-r bg-muted/20">
      <nav className="flex h-full flex-col gap-1 p-4">
        {categories.map((category) => (
          <Button
            key={category.id}
            variant={category.id === activeCategory ? "secondary" : "ghost"}
            className="justify-start"
            onClick={() => onCategoryChange(category.id)}
          >
            {category.label}
          </Button>
        ))}
      </nav>
    </aside>
  )
}

export { SettingsCategorySidebar }
