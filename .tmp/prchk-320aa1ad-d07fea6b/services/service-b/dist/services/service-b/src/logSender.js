"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendLog = sendLog;
const axios_1 = __importDefault(require("axios"));
async function sendLog(row) {
    try {
        const url = process.env.LOG_INGESTOR_URL || "http://localhost:3010/ingest-log";
        await axios_1.default.post(url, row, {
            timeout: 2000,
        });
    }
    catch (error) {
        console.error("Failed to send log to ingestor:", error.message);
    }
}
