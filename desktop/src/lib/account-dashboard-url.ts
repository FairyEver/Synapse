import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "@/generated/deployment-config.generated"

function normalizedPublicAppUrl(publicAppUrl: string): string {
  return publicAppUrl.trim().replace(/\/+$/u, "")
}

export function buildAccountDashboardHomeUrl(
  publicAppUrl: string = SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl,
): string {
  return new URL("/console/", normalizedPublicAppUrl(publicAppUrl)).toString()
}
