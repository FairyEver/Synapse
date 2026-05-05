import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { LicenseService } from "../../services/license"

const licenseStatusSchema = z.object({
  status: z.enum(["not_activated", "active", "expired", "invalid"]),
  email: z.string().nullable(),
  serverUrl: z.string().nullable(),
  deviceIdHash: z.string().nullable(),
  expiresAt: z.string().nullable(),
  lastRenewedAt: z.string().nullable(),
  message: z.string().optional(),
})

const activationRequestSchema = z.object({
  email: z.string().email(),
  activationCode: z.string().min(1),
})

export const licenseIpcModule: IpcModule = {
  id: "license",
  methods: {
    getStatus: {
      kind: "invoke",
      channel: "synapse:license:get-status",
      request: z.void(),
      response: licenseStatusSchema,
      handler: (ctx) => ctx.resolve<LicenseService>("core.license").getStatus(),
    },
    activate: {
      kind: "invoke",
      channel: "synapse:license:activate",
      request: activationRequestSchema,
      response: licenseStatusSchema,
      handler: (ctx, request) => ctx.resolve<LicenseService>("core.license").activate(
        activationRequestSchema.parse(request),
      ),
    },
    renew: {
      kind: "invoke",
      channel: "synapse:license:renew",
      request: z.void(),
      response: licenseStatusSchema,
      handler: (ctx) => ctx.resolve<LicenseService>("core.license").renew(),
    },
  },
  events: {},
}
