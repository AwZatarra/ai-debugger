import dotenv from "dotenv";
import { createClient } from "@clickhouse/client";

dotenv.config({ path: "../../.env" });

export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER || "aiuser",
  password: process.env.CLICKHOUSE_PASSWORD || "aipass123",
});