type MeasureOptionsWithDetail = PerformanceMeasureOptions & { detail?: unknown }
type PerformanceMeasureArgument = Parameters<Performance["measure"]>[1]

export function installReactPerformanceMeasureGuard(): () => void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") {
    return () => {}
  }

  const originalMeasure = performance.measure
  const guardedMeasure = function (
    this: Performance,
    measureName: string,
    startOrMeasureOptions?: PerformanceMeasureArgument,
    endMark?: string,
  ): PerformanceMeasure {
    try {
      return originalMeasure.call(this, measureName, startOrMeasureOptions, endMark)
    } catch (error) {
      if (!shouldRetryWithoutDetail(error, startOrMeasureOptions)) {
        throw error
      }

      const safeOptions = stripMeasureDetail(startOrMeasureOptions)
      return originalMeasure.call(this, measureName, safeOptions, endMark)
    }
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
    if (performance.measure === guardedMeasure) {
      Object.defineProperty(performance, "measure", {
        configurable: true,
        value: originalMeasure,
        writable: true,
      })
    }
  }
}

function shouldRetryWithoutDetail(error: unknown, options: unknown): options is MeasureOptionsWithDetail {
  return isDataCloneError(error) && hasMeasureDetail(options)
}

function isDataCloneError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "DataCloneError"
  }
  return error instanceof Error && error.name === "DataCloneError"
}

function hasMeasureDetail(options: unknown): options is MeasureOptionsWithDetail {
  return typeof options === "object" && options !== null && "detail" in options
}

function stripMeasureDetail(options: MeasureOptionsWithDetail): PerformanceMeasureOptions {
  const { detail: _detail, ...safeOptions } = options
  return safeOptions
}
