import express from "express";
import dotenv from "dotenv";
import { logger, buildLogContext } from "../../../shared/logger/logger";
import { sendLog } from "./logSender";

dotenv.config({ path: "../../.env" });

const app = express();
app.use(express.json());

const INVENTORY_TIMEOUT_MS = Number(process.env.INVENTORY_DB_TIMEOUT_MS || 2000);

function createDbTimeoutError(message = "Database timeout while fetching inventory") {
  const error = new Error(message) as Error & { code?: string };
  error.name = "TimeoutError";
  error.code = "DB_TIMEOUT";
  return error;
}

function isDbTimeoutError(error: any) {
  return (
    error?.code === "DB_TIMEOUT" ||
    error?.name === "TimeoutError" ||
    error?.message === "Database timeout while fetching inventory"
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message?: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(createDbTimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

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

app.get("/inventory", async (_req, res) => {
  const random = Math.random();

  try {
    if (random < 0.3) {
      throw createDbTimeoutError();
    }

    if (random >= 0.3 && random < 0.6) {
      await withTimeout(
        new Promise((resolve) => setTimeout(resolve, 2500)),
        INVENTORY_TIMEOUT_MS,
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
      const logData = buildLogContext({
        level: "error",
        service: "service-b",
        route: "/inventory",
        error_code: "DB_TIMEOUT",
        error_type: error.name,
        stack_trace: error.stack,
        payload: {
          simulatedFailure: true,
          timeout_ms: INVENTORY_TIMEOUT_MS,
        },
      });

      logger.error(logData, "Inventory failure");
      await persistLog(logData, "Inventory failure");

      return res.status(500).json({
        ok: false,
        error: "DB_TIMEOUT",
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