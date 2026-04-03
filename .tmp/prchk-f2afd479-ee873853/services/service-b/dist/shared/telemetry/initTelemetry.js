"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTelemetry = initTelemetry;
const sdk_node_1 = require("@opentelemetry/sdk-node");
const auto_instrumentations_node_1 = require("@opentelemetry/auto-instrumentations-node");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
function initTelemetry(serviceName) {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";
    const traceExporter = new exporter_trace_otlp_http_1.OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
    });
    const sdk = new sdk_node_1.NodeSDK({
        traceExporter,
        instrumentations: [(0, auto_instrumentations_node_1.getNodeAutoInstrumentations)()],
    });
    sdk.start();
    process.on("SIGTERM", async () => {
        await sdk.shutdown();
    });
    process.on("SIGINT", async () => {
        await sdk.shutdown();
    });
    console.log(`[telemetry] initialized for ${serviceName}`);
}
