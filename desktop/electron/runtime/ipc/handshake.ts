/**
 * Phase 0.3 — IPC protocol version handshake.
 * SPEC §15.2.
 *
 * On every renderer startup the renderer calls `synapse:system:handshake` with
 * its IPC_PROTOCOL_VERSION. The main process replies with the server version
 * + a minimumClientVersion. The renderer compares and either continues or
 * surfaces a "please reload / upgrade" toast.
 *
 * This module exposes the IpcModule descriptor and a tiny pure helper that
 * computes the response shape so it can be unit-tested without booting
 * Electron.
 */

import { z } from "zod"
import {
  IPC_PROTOCOL_VERSION,
  type IpcHandshakeRequest,
  type IpcHandshakeResponse,
  type IpcMethodDescriptor,
  type IpcModule,
} from "./types"

/** Bump this when an old client must hard-fail rather than degrade silently. */
export const IPC_MINIMUM_CLIENT_VERSION = 1 as const

export function computeHandshakeResponse(request: IpcHandshakeRequest): IpcHandshakeResponse {
  const serverVersion = IPC_PROTOCOL_VERSION
  const minimumClientVersion = IPC_MINIMUM_CLIENT_VERSION
  if (request.clientVersion < minimumClientVersion) {
    return {
      ok: false,
      serverVersion,
      minimumClientVersion,
    }
  }
  return {
    ok: true,
    serverVersion,
  }
}

const handshakeRequestSchema = z.object({
  clientVersion: z.number().int().min(0),
})

const handshakeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    serverVersion: z.number().int(),
  }),
  z.object({
    ok: z.literal(false),
    serverVersion: z.number().int(),
    minimumClientVersion: z.number().int(),
  }),
])

const handshakeMethod: IpcMethodDescriptor<IpcHandshakeRequest, IpcHandshakeResponse> = {
  kind: "invoke",
  channel: "synapse:system:handshake",
  request: handshakeRequestSchema,
  response: handshakeResponseSchema,
  handler: (_ctx, request) => computeHandshakeResponse(request),
}

export const systemIpcModule: IpcModule = {
  id: "system",
  methods: {
    handshake: handshakeMethod,
  },
  events: {},
}
