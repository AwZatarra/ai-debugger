"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.getTraceContext = getTraceContext;
exports.buildLogContext = buildLogContext;
const pino_1 = __importDefault(require("pino"));
const api_1 = require("@opentelemetry/api");
exports.logger = (0, pino_1.default)({
    level: "info",
    base: undefined,
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
    formatters: {
        level(label) {
            return { level: label };
        },
    },
});
function getTraceContext() {
    const span = api_1.trace.getSpan(api_1.context.active());
    const spanContext = span?.spanContext();
    return {
        trace_id: spanContext?.traceId ?? "",
        span_id: spanContext?.spanId ?? "",
    };
}
function buildLogContext(extra = {}) {
    return {
        ...getTraceContext(),
        ...extra,
    };
}
