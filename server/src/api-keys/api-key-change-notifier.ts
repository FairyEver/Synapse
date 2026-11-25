import { Injectable } from "@nestjs/common"

export type ApiKeyChangeEvent =
  | {
      readonly kind: "revoked"
      readonly userId: string
      readonly apiKeyId: string
    }
  | {
      readonly kind: "updated"
      readonly userId: string
      readonly apiKeyId: string
      readonly scopes: readonly string[]
      readonly channelAccessMode: "selected" | "all_owned"
      readonly channelIds: readonly string[]
    }
  | {
      readonly kind: "user_disabled"
      readonly userId: string
    }

type ApiKeyChangeListener = (event: ApiKeyChangeEvent) => void

@Injectable()
export class ApiKeyChangeNotifier {
  private readonly listeners = new Set<ApiKeyChangeListener>()

  onChange(listener: ApiKeyChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: ApiKeyChangeEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event)
    }
  }
}
