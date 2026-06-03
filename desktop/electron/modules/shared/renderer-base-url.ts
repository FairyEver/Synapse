import { app } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"

export function rendererBaseUrl(): string {
  return process.env.VITE_DEV_SERVER_URL
    ?? pathToFileURL(path.join(app.getAppPath(), "dist/index.html")).toString()
}
