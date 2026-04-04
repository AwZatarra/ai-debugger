import pino from "pino";
import { context, trace } from "@opentelemetry/api";

export const logger = pino({
  level: "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export function getTraceContext() {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();

  return {
    trace_id: spanContext?.traceId ?? "",
    span_id: spanContext?.spanId ?? "",
  };
}

export function buildLogContext(extra: Record<string, any> = {}) {
  return {
    ...getTraceContext(),
    ...extra,
  };
}