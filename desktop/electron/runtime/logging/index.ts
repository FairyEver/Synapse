export {
  ArraySink,
  ConsoleSink,
  LogRotator,
  LOG_LEVELS,
  createLogger,
} from "./logger"
export type {
  LogLevel,
  LogRecord,
  LogRotatorOptions,
  LogSink,
  LoggerOptions,
} from "./logger"
// StructuredLogger is re-exported from service-registry/types.ts for unified interface.
export type { StructuredLogger } from "../service-registry/types"
