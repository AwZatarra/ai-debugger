import dotenv from "dotenv";
import { initTelemetry } from "../../../shared/telemetry/initTelemetry";

dotenv.config({ path: "../../.env" });

initTelemetry("service-a");