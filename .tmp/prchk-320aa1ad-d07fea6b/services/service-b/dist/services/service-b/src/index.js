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
const INVENTORY_TIMEOUT_MS = Number(process.env.INVENTORY_DB_TIMEOUT_MS || 2000);
function createDbTimeoutError(message = "Database timeout while fetching inventory") {
    const error = new Error(message);
    error.name = "TimeoutError";
    error.code = "DB_TIMEOUT";
    return error;
}
function isDbTimeoutError(error) {
    return (error?.code === "DB_TIMEOUT" ||
        error?.name === "TimeoutError" ||
        error?.message === "Database timeout while fetching inventory");
}
async function withTimeout(promise, timeoutMs, message) {
    let timeoutHandle;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(createDbTimeoutError(message)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
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
app.get("/inventory", async (_req, res) => {
    const random = Math.random();
    try {
        if (random < 0.3) {
            throw createDbTimeoutError();
        }
        if (random >= 0.3 && random < 0.6) {
            await withTimeout(new Promise((resolve) => setTimeout(resolve, 2500)), INVENTORY_TIMEOUT_MS, "Database timeout while fetching inventory");
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
            const logData = (0, logger_1.buildLogContext)({
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
            logger_1.logger.error(logData, "Inventory failure");
            await persistLog(logData, "Inventory failure");
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
