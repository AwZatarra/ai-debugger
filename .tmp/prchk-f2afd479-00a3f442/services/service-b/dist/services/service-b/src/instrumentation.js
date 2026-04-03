"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const initTelemetry_1 = require("../../../shared/telemetry/initTelemetry");
dotenv_1.default.config({ path: "../../.env" });
(0, initTelemetry_1.initTelemetry)("service-b");
