import type { SynapseSkillInstallerSource } from "../../../src/types/installers"

export type HubInstallPrepareResult = { ok: true; source: SynapseSkillInstallerSource }
  | { ok: false; code: string; message: string }
