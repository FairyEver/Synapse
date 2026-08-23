const APP_PUBLIC_URL_PLACEHOLDER = "{{APP_PUBLIC_URL}}"
const DEVELOPMENT_APP_PUBLIC_URL = "http://localhost:3000"
const PRODUCTION_APP_PUBLIC_URL = "https://synapse.d2.pub"

function normalizeHttpUrl(value, name) {
  const normalized = value.trim().replace(/\/+$/u, "")
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`${name} must be a valid http(s) URL.`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http or https.`)
  }
  return normalized
}

function resolveDocumentAppPublicUrl(env, isDevelopment) {
  const explicitDocumentBuildUrl = env.SYNAPSE_DOCUMENT_APP_PUBLIC_URL?.trim()
  if (explicitDocumentBuildUrl) {
    return normalizeHttpUrl(explicitDocumentBuildUrl, "SYNAPSE_DOCUMENT_APP_PUBLIC_URL")
  }
  if (isDevelopment) return DEVELOPMENT_APP_PUBLIC_URL

  const configuredPublicAppUrl = env.APP_PUBLIC_URL?.trim() || PRODUCTION_APP_PUBLIC_URL
  return normalizeHttpUrl(configuredPublicAppUrl, "APP_PUBLIC_URL")
}

function replaceDocumentDeploymentLinks(markdown, appPublicUrl) {
  return markdown.replaceAll(APP_PUBLIC_URL_PLACEHOLDER, appPublicUrl)
}

export {
  replaceDocumentDeploymentLinks,
  resolveDocumentAppPublicUrl,
}
