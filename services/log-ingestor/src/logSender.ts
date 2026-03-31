import axios from "axios";

export async function sendLog(row: Record<string, any>) {
  try {
    const url =
      process.env.LOG_INGESTOR_URL || "http://localhost:3010/ingest-log";

    await axios.post(url, row, {
      timeout: 2000,
    });
  } catch (error: any) {
    console.error("Failed to send log to ingestor:", error.message);
  }
}