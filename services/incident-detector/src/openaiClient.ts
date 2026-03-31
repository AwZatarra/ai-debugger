import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: "../../.env" });

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";