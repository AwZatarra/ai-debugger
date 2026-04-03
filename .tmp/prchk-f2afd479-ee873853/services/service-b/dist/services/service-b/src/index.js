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
const INVENTORY_QUERY_TIMEOUT_MS = Number(process.env.INVENTORY_QUERY_TIMEOUT_MS || 2000);
class InventoryTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "InventoryTimeoutError";
        this.code = "INVENTORY_TIMEOUT";
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
function isInventoryTimeoutError(error) {
    const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
    const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
    return (error instanceof InventoryTimeoutError ||
        code === "INVENTORY_TIMEOUT" ||
        code === "DB_TIMEOUT" ||
        message.includes("timeout"));
}
function withTimeout(promise, timeoutMs, message) {
    let timer;
    return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            reject(new InventoryTimeoutError(message));
        }, timeoutMs);
        promise
            .then((value) => {
            if (timer) {
                clearTimeout(timer);
            }
            resolve(value);
        })
            .catch((error) => {
            if (timer) {
                clearTimeout(timer);
            }
            reject(error);
        });
    });
}
async function fetchInventory(random) {
    if (random < 0.3) {
        const error = new Error("Database timeout while fetching inventory");
        error.code = "DB_TIMEOUT";
        throw error;
    }
    if (random >= 0.3 && random < 0.6) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    return { items: 12 };
}
app.get("/inventory", async (_req, res) => {
    const random = Math.random();
    try {
        const inventory = await withTimeout(fetchInventory(random), INVENTORY_QUERY_TIMEOUT_MS, `Inventory query exceeded ${INVENTORY_QUERY_TIMEOUT_MS}ms`);
        const logData = (0, logger_1.buildLogContext)({
            level: "info",
            service: "service-b",
            route: "/inventory",
            payload: { items: inventory.items },
        });
        logger_1.logger.info(logData, "Inventory success");
        await persistLog(logData, "Inventory success");
        return res.json({
            ok: true,
            items: inventory.items,
        });
    }
    catch (error) {
        if (isInventoryTimeoutError(error)) {
            const logData = (0, logger_1.buildLogContext)({
                level: "error",
                service: "service-b",
                route: "/inventory",
                error_code: "INVENTORY_TIMEOUT",
                error_type: error.name,
                stack_trace: error.stack,
                payload: {
                    timeout_ms: INVENTORY_QUERY_TIMEOUT_MS,
                    original_error_code: error.code || "",
                },
            });
            logger_1.logger.error(logData, "Inventory request timed out");
            await persistLog(logData, "Inventory request timed out");
            return res.status(504).json({
                ok: false,
                error: "INVENTORY_TIMEOUT",
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
