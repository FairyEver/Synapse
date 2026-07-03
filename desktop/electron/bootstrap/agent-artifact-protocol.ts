import { app, net, protocol } from "electron"
import { stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  AGENT_ARTIFACT_PROTOCOL_SCHEME,
  resolveAgentArtifactUrlPath,
} from "../services/agent-runtime/artifact-url"

let protocolRegistered = false

function registerAgentArtifactProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: AGENT_ARTIFACT_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  }])
}

function registerAgentArtifactProtocol(rootDirectory = path.join(app.getPath("userData"), "agent-artifacts")): void {
  if (protocolRegistered) return
  protocol.handle(AGENT_ARTIFACT_PROTOCOL_SCHEME, async (request) => {
    const filePath = resolveAgentArtifactUrlPath(rootDirectory, request.url)
    if (!filePath) return notFoundResponse()
    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) return notFoundResponse()
    } catch {
      return notFoundResponse()
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
  protocolRegistered = true
}

function notFoundResponse(): Response {
  return new Response("Not found", { status: 404 })
}

export {
  registerAgentArtifactProtocol,
  registerAgentArtifactProtocolScheme,
}
