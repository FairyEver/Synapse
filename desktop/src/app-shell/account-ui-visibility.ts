import { getSynapseBridge } from "@/lib/electron-bridge"

function isAccountUiVisible(): boolean {
  return getSynapseBridge()?.isPackaged !== true
}

export { isAccountUiVisible }
