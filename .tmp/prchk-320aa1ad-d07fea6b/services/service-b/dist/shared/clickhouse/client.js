"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clickhouse = void 0;
const client_1 = require("@clickhouse/client");
exports.clickhouse = (0, client_1.createClient)({
    url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
});
