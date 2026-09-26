export declare const INTERNAL_KEYS: string[]

export declare function redact(value: unknown): unknown

export interface ConsumerView {
  utterance: string
  recommend: Record<string, unknown>
  search: Record<string, unknown>
  registeredCapabilityIds: string[]
}

export interface EvalSdk {
  catalog: {
    recommend(utterance: string): Record<string, unknown>
    search(keyword: string): Record<string, unknown>
    describe(capabilityId: string): Record<string, unknown>
    describePage(pageId: string): Record<string, unknown>
    listDomains(): Record<string, unknown>
    listPages(domain: string): Record<string, unknown>
  }
}

export declare const ENTRY_CANDIDATES: string[]
export declare const SOURCE_ENTRY_CANDIDATES: string[]
export declare function loadEntry(candidates?: string[]): Promise<Record<string, unknown>>

export declare function makeSdk(candidates?: string[]): Promise<EvalSdk>
export declare function makeSourceSdk(): Promise<EvalSdk>
export declare function consumerView(utterance: string, candidates?: string[]): Promise<ConsumerView>
export declare function consumeViewWith(sdk: EvalSdk, utterance: string): ConsumerView
export declare function listRegisteredCapabilityIds(sdk: EvalSdk): string[]
export declare function describeCapability(
  capabilityId: string,
  candidates?: string[],
): Promise<Record<string, unknown>>
export declare function describePageRef(
  pageId: string,
  candidates?: string[],
): Promise<Record<string, unknown>>
