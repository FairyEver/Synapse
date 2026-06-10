import type { SynapseContentStoreInstallWindowRequest } from "../types/content-store-install"

const CONTENT_STORE_INSTALL_HOST = "content-install"
const CONTENT_STORE_INSTALL_WINDOW_KIND = "content-store-install"
const WINDOW_KIND_PARAM = "synapseWindow"

function parseContentStoreInstallProtocolUrl(
  rawUrl: string,
): SynapseContentStoreInstallWindowRequest | null {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (
    url.protocol !== "synapse:"
    || url.hostname !== CONTENT_STORE_INSTALL_HOST
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

function buildContentStoreInstallWindowSearchParams(
  request: SynapseContentStoreInstallWindowRequest,
): URLSearchParams {
  return new URLSearchParams({
    [WINDOW_KIND_PARAM]: CONTENT_STORE_INSTALL_WINDOW_KIND,
    session: request.session,
  })
}

function parseContentStoreInstallWindowRequest(
  search: string,
): SynapseContentStoreInstallWindowRequest | null {
  const params = new URLSearchParams(search)

  if (params.get(WINDOW_KIND_PARAM) !== CONTENT_STORE_INSTALL_WINDOW_KIND) {
    return null
  }

  const session = params.get("session")?.trim() ?? ""
  return session ? { session } : null
}

export {
  buildContentStoreInstallWindowSearchParams,
  parseContentStoreInstallProtocolUrl,
  parseContentStoreInstallWindowRequest,
}
