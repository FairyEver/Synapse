type MeasureOptionsWithDetail = PerformanceMeasureOptions & { detail?: unknown }
type PerformanceMeasureArgument = Parameters<Performance["measure"]>[1]

// 每个 Renderer 仅保留最近 256 条 React 开发诊断；不清除业务 measure/mark。
export const REACT_MEASURE_RETENTION_LIMIT = 256
const REACT_MEASURE_NAME_PREFIX = "synapse.react:"

export function installReactPerformanceMeasureGuard(): () => void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") {
    return () => {}
  }

  const originalMeasure = performance.measure
  const retainedNames: string[] = []
  const clearRetainedMeasure = (name: string) => performance.clearMeasures(name)
  const guardedMeasure = function (
    this: Performance,
    measureName: string,
    startOrMeasureOptions?: PerformanceMeasureArgument,
    endMark?: string,
  ): PerformanceMeasure {
    const safeStartOrMeasureOptions = hasMeasureDetail(startOrMeasureOptions)
      ? stripMeasureDetail(startOrMeasureOptions)
      : startOrMeasureOptions
    const reactMeasure = isReactMeasure(startOrMeasureOptions)
      && typeof performance.clearMeasures === "function"
    // 独立名称避免 React 的同名记录清理掉业务诊断。
    const nativeName = reactMeasure ? `${REACT_MEASURE_NAME_PREFIX}${measureName.slice(0, 256)}` : measureName
    const result = originalMeasure.call(this, nativeName, safeStartOrMeasureOptions, endMark)
    if (reactMeasure) {
      retainedNames.push(nativeName)
      if (retainedNames.length > REACT_MEASURE_RETENTION_LIMIT) {
        clearRetainedMeasure(retainedNames.shift()!)
      }
    }
    return result
  }

  try {
    Object.defineProperty(performance, "measure", {
      configurable: true,
      value: guardedMeasure,
      writable: true,
    })
  } catch {
    return () => {}
  }

  return () => {
    for (const name of new Set(retainedNames)) clearRetainedMeasure(name)
    retainedNames.length = 0
    if (performance.measure === guardedMeasure) {
      Object.defineProperty(performance, "measure", {
        configurable: true,
        value: originalMeasure,
        writable: true,
      })
    }
  }
}

function isReactMeasure(options: unknown): boolean {
  if (!hasMeasureDetail(options)) return false
  const detail = options.detail
  if (typeof detail !== "object" || detail === null || !("devtools" in detail)) return false
  const devtools = detail.devtools
  if (typeof devtools !== "object" || devtools === null) return false
  return ("track" in devtools && devtools.track === "Components ⚛")
    || ("trackGroup" in devtools && devtools.trackGroup === "Scheduler ⚛")
}

function hasMeasureDetail(options: unknown): options is MeasureOptionsWithDetail {
  return typeof options === "object" && options !== null && "detail" in options
}

function stripMeasureDetail(options: MeasureOptionsWithDetail): PerformanceMeasureOptions {
  const safeOptions = { ...options }
  delete safeOptions.detail
  return safeOptions
}
