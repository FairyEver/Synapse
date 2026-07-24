import type { BuiltinCapabilityPackageManifestV1 } from "../../manifest"
import {
  CLIPBOARD_CAPABILITY_VERSION,
  CLIPBOARD_PACKAGE_ID,
  CLIPBOARD_PACKAGE_VERSION,
  CLIPBOARD_TEXT_READ_CAPABILITY_ID,
  CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
  CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
  CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
} from "./capability"

export const clipboardPackageManifest = {
  schemaVersion: 1,
  packageId: CLIPBOARD_PACKAGE_ID,
  packageVersion: CLIPBOARD_PACKAGE_VERSION,
  capabilities: [
    {
      id: CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
      version: CLIPBOARD_CAPABILITY_VERSION,
      availability: "always",
      userToggle: "none",
    },
    {
      id: CLIPBOARD_TEXT_READ_CAPABILITY_ID,
      version: CLIPBOARD_CAPABILITY_VERSION,
      availability: "always",
      userToggle: "none",
    },
  ],
  workflowNodes: [
    {
      type: CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
      capabilityId: CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
      discovery: "visible",
    },
    {
      type: CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
      capabilityId: CLIPBOARD_TEXT_READ_CAPABILITY_ID,
      discovery: "visible",
    },
  ],
  automationActions: [],
  mcpTools: [],
  systemApp: null,
  deepLinks: [],
} as const satisfies BuiltinCapabilityPackageManifestV1
