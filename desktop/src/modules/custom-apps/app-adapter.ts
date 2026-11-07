import { Globe, type LucideIcon } from "lucide-react"
import type {
  CustomAppDto,
  CustomAppsClientState,
} from "@synapse/shared"

import {
  systemAppPresentation,
  type AppCategoryId,
} from "@/modules/apps/app-presentation"
import type {
  SynapseSystemAppId,
  SynapseSystemAppManifest,
} from "@/modules/apps/types"

export type AppIconDescriptor =
  | { readonly kind: "lucide"; readonly icon: LucideIcon }
  | { readonly kind: "image"; readonly src: string }

export type AppCatalogEntry =
  | {
      readonly kind: "system"
      readonly id: SynapseSystemAppId
      readonly name: string
      readonly category: AppCategoryId | null
      readonly icon: AppIconDescriptor
      readonly removable: boolean
      readonly pinnable: boolean
    }
  | {
      readonly kind: "custom-web"
      readonly id: CustomAppDto["id"]
      readonly name: string
      readonly category: "custom"
      readonly icon: AppIconDescriptor
      readonly removable: true
      readonly pinnable: true
      readonly app: CustomAppDto
    }

export const CUSTOM_APP_FALLBACK_ICON: AppIconDescriptor = {
  kind: "lucide",
  icon: Globe,
}

export function buildAppCatalog(
  systemApps: readonly SynapseSystemAppManifest[],
  customState: CustomAppsClientState,
): AppCatalogEntry[] {
  const systems: AppCatalogEntry[] = systemApps.map((app) => ({
    kind: "system",
    id: app.id,
    name: app.name,
    category: systemAppPresentation[app.id].category,
    icon: { kind: "lucide", icon: systemAppPresentation[app.id].icon },
    removable: app.id !== "launcher",
    pinnable: app.id !== "launcher" && app.dock.pinnable !== false,
  }))
  const customApps = [...(customState.snapshot?.apps ?? [])]
    .filter((app) => app.kind === "web")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .map<AppCatalogEntry>((app) => ({
      kind: "custom-web",
      id: app.id,
      name: app.name,
      category: "custom",
      icon: app.iconUrl ? { kind: "image", src: app.iconUrl } : CUSTOM_APP_FALLBACK_ICON,
      removable: true,
      pinnable: true,
      app,
    }))
  return [...systems, ...customApps]
}
