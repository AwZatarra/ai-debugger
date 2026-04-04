import express from "express";
import dotenv from "dotenv";
import { logger, buildLogContext } from "../../../shared/logger/logger";
import { sendLog } from "./logSender";

dotenv.config({ path: "../../.env" });

const app = express();
app.use(express.json());

async function persistLog(data: Record<string, any>, message: string) {
  const row = {
    timestamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
    service: "service-b",
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

function isDbTimeoutError(error: any) {
  if (!error) {
    return false;
  }

  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const name = typeof error.name === "string" ? error.name.toLowerCase() : "";

  return (
    code === "DB_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    message.includes("database timeout") ||
    message.includes("db timeout") ||
    message.includes("timed out") ||
    name.includes("timeout")
  );
}

async function logInventoryDbTimeout(error: any, payload: Record<string, any> = {}) {
  const logData = buildLogContext({
    level: "error",
    service: "service-b",
    route: "/inventory",
    error_code: "DB_TIMEOUT",
    error_type: error?.name || "Error",
    stack_trace: error?.stack || "",
    payload,
  });

  logger.error(logData, "Inventory failure");
  await persistLog(logData, "Inventory failure");
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(timeoutMessage) as Error & { code?: string };
      err.name = "TimeoutError";
      err.code = "DB_TIMEOUT";
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

app.get("/inventory", async (_req, res) => {
  const random = Math.random();

  try {
    if (random < 0.3) {
      const err = new Error("Database timeout while fetching inventory") as Error & { code?: string };
      err.code = "DB_TIMEOUT";

      await logInventoryDbTimeout(err, { simulatedFailure: true });

      return res.status(504).json({
        ok: false,
        error: "DB_TIMEOUT",
        message: "Inventory request timed out",
      });
    }

    if (random >= 0.3 && random < 0.6) {
      await withTimeout(
        new Promise((resolve) => setTimeout(resolve, 2500)),
        2000,
        "Database timeout while fetching inventory"
      );
    }

    const logData = buildLogContext({
      level: "info",
      service: "service-b",
      route: "/inventory",
      payload: { items: 12 },
    });

    logger.info(logData, "Inventory success");
    await persistLog(logData, "Inventory success");

    return res.json({
      ok: true,
      items: 12,
    });
  } catch (error: any) {
    if (isDbTimeoutError(error)) {
      await logInventoryDbTimeout(error, {});

      return res.status(504).json({
        ok: false,
        error: "DB_TIMEOUT",
        message: "Inventory request timed out",
      });
    }

    const logData = buildLogContext({
      level: "error",
      service: "service-b",
      route: "/inventory",
      error_code: "UNHANDLED_ERROR",
      error_type: error.name,
      stack_trace: error.stack,
      payload: {},
    });

    logger.error(logData, "Unhandled inventory error");
    await persistLog(logData, "Unhandled inventory error");

    return res.status(500).json({
      ok: false,
      error: "UNHANDLED_ERROR",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "service-b" });
});

app.listen(3002, () => {
  console.log("service-b running on http://localhost:3002");
});