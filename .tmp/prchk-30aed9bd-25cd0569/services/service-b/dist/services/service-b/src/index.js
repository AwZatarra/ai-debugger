"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("../../../shared/logger/logger");
const logSender_1 = require("./logSender");
dotenv_1.default.config({ path: "../../.env" });
const app = (0, express_1.default)();
app.use(express_1.default.json());
async function persistLog(data, message) {
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
    await (0, logSender_1.sendLog)(row);
}
function isDbTimeoutError(error) {
    if (!error) {
        return false;
    }
    const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
    const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
    const name = typeof error.name === "string" ? error.name.toLowerCase() : "";
    return (code === "DB_TIMEOUT" ||
        code === "ETIMEDOUT" ||
        message.includes("database timeout") ||
        message.includes("db timeout") ||
        message.includes("timed out") ||
        name.includes("timeout"));
}
async function logInventoryDbTimeout(error, payload = {}) {
    const logData = (0, logger_1.buildLogContext)({
        level: "error",
        service: "service-b",
        route: "/inventory",
        error_code: "DB_TIMEOUT",
        error_type: error?.name || "Error",
        stack_trace: error?.stack || "",
        payload,
    });
    logger_1.logger.error(logData, "Inventory failure");
    await persistLog(logData, "Inventory failure");
}
async function withTimeout(operation, timeoutMs, timeoutMessage) {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            const err = new Error(timeoutMessage);
            err.name = "TimeoutError";
            err.code = "DB_TIMEOUT";
            reject(err);
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, timeoutPromise]);
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
app.get("/inventory", async (_req, res) => {
    const random = Math.random();
    try {
        if (random < 0.3) {
            const err = new Error("Database timeout while fetching inventory");
            err.code = "DB_TIMEOUT";
            await logInventoryDbTimeout(err, { simulatedFailure: true });
            return res.status(500).json({
                ok: false,
                error: "DB_TIMEOUT",
            });
        }
        if (random >= 0.3 && random < 0.6) {
            await withTimeout(new Promise((resolve) => setTimeout(resolve, 2500)), 2000, "Database timeout while fetching inventory");
        }
        const logData = (0, logger_1.buildLogContext)({
            level: "info",
            service: "service-b",
            route: "/inventory",
            payload: { items: 12 },
        });
        logger_1.logger.info(logData, "Inventory success");
        await persistLog(logData, "Inventory success");
        return res.json({
            ok: true,
            items: 12,
        });
    }
    catch (error) {
        if (isDbTimeoutError(error)) {
            await logInventoryDbTimeout(error, {});
            return res.status(500).json({
                ok: false,
                error: "DB_TIMEOUT",
            });
        }
        const logData = (0, logger_1.buildLogContext)({
            level: "error",
            service: "service-b",
            route: "/inventory",
            error_code: "UNHANDLED_ERROR",
            error_type: error.name,
            stack_trace: error.stack,
            payload: {},
        });
        logger_1.logger.error(logData, "Unhandled inventory error");
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
