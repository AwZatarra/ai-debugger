import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { logger, buildLogContext } from "../../../shared/logger/logger";
import { sendLog } from "./logSender";

dotenv.config({ path: "../../.env" });

const app = express();
app.use(express.json());

async function persistLog(data: Record<string, any>, message: string) {
  const row = {
    timestamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
    service: "service-a",
    environment: process.env.NODE_ENV || "development",
    level: data.level || "info",
    message,
    trace_id: data.trace_id || "",
    span_id: data.span_id || "",
    request_id: data.request_id || "",
    route: data.route || "",
    error_code: data.error_code || "",
    error_type: data.error_type || "",
    stack_trace: data.stack_trace || "",
    payload: JSON.stringify(data.payload || {}),
  };

  await sendLog(row);
}

app.get("/checkout", async (_req, res) => {
  const start = Date.now();

  try {
    const startLog = buildLogContext({
      level: "info",
      service: "service-a",
      route: "/checkout",
      payload: { stage: "start" },
    });

    logger.info(startLog, "Checkout started");
    await persistLog(startLog, "Checkout started");

    const response = await axios.get("http://localhost:3002/inventory", {
      timeout: 4000,
    });

    const successLog = buildLogContext({
      level: "info",
      service: "service-a",
      route: "/checkout",
      payload: {
        latency_ms: Date.now() - start,
        inventory_response: response.data,
      },
    });

    logger.info(successLog, "Checkout success");
    await persistLog(successLog, "Checkout success");

    return res.json({
      ok: true,
      inventory: response.data,
      latency_ms: Date.now() - start,
    });
  } catch (error: any) {
    const errorLog = buildLogContext({
      level: "error",
      service: "service-a",
      route: "/checkout",
      error_code: error.code || "UPSTREAM_ERROR",
      error_type: error.name || "Error",
      stack_trace: error.stack || "",
      payload: {
        latency_ms: Date.now() - start,
        upstream_status: error.response?.status || null,
        upstream_data: error.response?.data || null,
      },
    });

    logger.error(errorLog, "Checkout failed");
    await persistLog(errorLog, "Checkout failed");

    return res.status(500).json({
      ok: false,
      error: "CHECKOUT_FAILED",
      detail: error.response?.data || error.message,
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "service-a" });
});

app.listen(3001, () => {
  console.log("service-a running on http://localhost:3001");
});