import { accountService } from "./account-service"
import { LiveConnectionService } from "./live-connection-service"

export const liveConnectionService = new LiveConnectionService({
  accountService,
})
