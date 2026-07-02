import type { SynapseSkillRepositoryInstallWindowRequest } from "../types/skill-repository-install"

const SKILL_REPOSITORY_INSTALL_HOST = "skill-install"
const SKILL_REPOSITORY_INSTALL_WINDOW_KIND = "skill-repository-install"
const WINDOW_KIND_PARAM = "synapseWindow"

function parseSkillRepositoryInstallProtocolUrl(
  rawUrl: string,
): SynapseSkillRepositoryInstallWindowRequest | null {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (
    url.protocol !== "synapse:"
    || url.hostname !== SKILL_REPOSITORY_INSTALL_HOST
    || url.pathname !== ""
    || url.hash !== ""
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || Array.from(url.searchParams.keys()).length !== 1
    || url.searchParams.getAll("session").length !== 1
  ) {
    return null
  }

  const session = url.searchParams.get("session")?.trim() ?? ""
  return session ? { session } : null
}

function buildSkillRepositoryInstallWindowSearchParams(
  request: SynapseSkillRepositoryInstallWindowRequest,
): URLSearchParams {
  return new URLSearchParams({
    [WINDOW_KIND_PARAM]: SKILL_REPOSITORY_INSTALL_WINDOW_KIND,
    session: request.session,
  })
}

function parseSkillRepositoryInstallWindowRequest(
  search: string,
): SynapseSkillRepositoryInstallWindowRequest | null {
  const params = new URLSearchParams(search)

  if (params.get(WINDOW_KIND_PARAM) !== SKILL_REPOSITORY_INSTALL_WINDOW_KIND) {
    return null
  }

  const session = params.get("session")?.trim() ?? ""
  return session ? { session } : null
}

export {
  buildSkillRepositoryInstallWindowSearchParams,
  parseSkillRepositoryInstallProtocolUrl,
  parseSkillRepositoryInstallWindowRequest,
}
