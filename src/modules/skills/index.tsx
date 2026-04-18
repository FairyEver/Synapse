import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"

type SkillsModuleProps = {
  onDetailDialogOpenChange?: (open: boolean) => void
}

function SkillsModule({ onDetailDialogOpenChange }: SkillsModuleProps) {
  return (
    <ContentBrowserPage
      contentType="skill"
      title="Skills"
      onDetailDialogOpenChange={onDetailDialogOpenChange}
    />
  )
}

export { SkillsModule }
