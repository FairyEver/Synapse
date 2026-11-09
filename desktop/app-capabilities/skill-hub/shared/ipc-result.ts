import type { SynapseSkillInstallerSource } from "../../../src/types/installers"
import type { SkillHubDetail } from "@synapse/shared/skill-hub-contracts"

export type HubInstallPrepareResult = { ok: true; source: SynapseSkillInstallerSource }
  | { ok: false; code: string; message: string }

export type HubCatalogResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string }
export type HubCatalogDetail = { skill: SkillHubDetail; content: string }
