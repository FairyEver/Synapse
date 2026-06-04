import { RepositorySetupPanel } from "@/app-shell/components/repository-setup-panel"

type EmptyRepositoryStateProps = {
  reason: "no-repositories" | "active-repository-missing"
}

function EmptyRepositoryState({ reason }: EmptyRepositoryStateProps) {
  return <RepositorySetupPanel reason={reason} layout="full" />
}

export { EmptyRepositoryState }
export type { EmptyRepositoryStateProps }
