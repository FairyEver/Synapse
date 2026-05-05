const PRODUCTION_LICENSE_SERVER_URL = "https://synapse.d2.pub"

export function getLicenseServerUrl(): string {
  return process.env.SYNAPSE_LICENSE_SERVER_URL || PRODUCTION_LICENSE_SERVER_URL
}

export function isDevLicenseServer(): boolean {
  return !!process.env.SYNAPSE_LICENSE_SERVER_URL
}
