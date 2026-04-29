import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  ADMIN_JWT_SECRET: z.string().min(16),
  LICENSE_PRIVATE_KEY: z.string().min(1),
  LICENSE_PUBLIC_KEY: z.string().min(1),
  LICENSE_KEY_ID: z.string().min(1),
  LICENSE_LEASE_DAYS: z.coerce.number().int().positive().default(7),
  PORT: z.coerce.number().int().positive().default(3000),
})

export interface ServerEnv {
  readonly databaseUrl: string
  readonly adminEmail: string
  readonly adminPassword: string
  readonly adminJwtSecret: string
  readonly licensePrivateKey: string
  readonly licensePublicKey: string
  readonly licenseKeyId: string
  readonly licenseLeaseDays: number
  readonly port: number
}

export function loadEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(`Invalid server environment: ${first?.path.join(".")}`)
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    adminEmail: result.data.ADMIN_EMAIL,
    adminPassword: result.data.ADMIN_PASSWORD,
    adminJwtSecret: result.data.ADMIN_JWT_SECRET,
    licensePrivateKey: result.data.LICENSE_PRIVATE_KEY,
    licensePublicKey: result.data.LICENSE_PUBLIC_KEY,
    licenseKeyId: result.data.LICENSE_KEY_ID,
    licenseLeaseDays: result.data.LICENSE_LEASE_DAYS,
    port: result.data.PORT,
  }
}
