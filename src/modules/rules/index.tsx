import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"

type RulesModuleProps = {
  onDetailDialogOpenChange?: (open: boolean) => void
}

function RulesModule({ onDetailDialogOpenChange }: RulesModuleProps) {
  return (
    <ContentBrowserPage
      contentType="rule"
      title="Rules"
      onDetailDialogOpenChange={onDetailDialogOpenChange}
    />
  )
}

export { RulesModule }
