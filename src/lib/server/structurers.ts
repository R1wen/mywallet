import "server-only";
import type { ReceiptStructurerName } from "@/lib/db/schema";
import type { ParsedReceipt } from "@/lib/domain/receipts/parse";
import { serverEnv } from "@/lib/env";
import {
  MODEL_PROMPT,
  MODEL_RECEIPT_JSON_SCHEMA,
  parseModelReceipt,
} from "@/lib/validation/model-receipt";
import type { StoredFile } from "./storage";

/**
 * Optional vision-model structurers (ADR-029), used only when the rules parser is not
 * confident and the user selected one. Their output goes through the same Zod mapping,
 * deterministic validation and human review as the rules. Logs never contain receipt
 * content: only the structurer name and an error class.
 */
export type ReceiptStructurer = {
  name: Exclude<ReceiptStructurerName, "rules">;
  available(): boolean;
  structure(file: StoredFile, ocrText: string): Promise<ParsedReceipt | null>;
};

const TIMEOUT_MS = 45_000;
const isImage = (f: StoredFile) => f.mimeType !== "application/pdf" && f.mimeType !== "image/heic";

function userPrompt(ocrText: string): string {
  // OCR text helps small models; it is the user's own receipt, sent to the chosen model only.
  return ocrText
    ? `${MODEL_PROMPT}\n\nTexte lu par OCR (peut contenir des erreurs) :\n${ocrText.slice(0, 8000)}`
    : MODEL_PROMPT;
}

export const ollamaStructurer: ReceiptStructurer = {
  name: "ollama",
  available: () => Boolean(serverEnv().OLLAMA_URL),
  async structure(file, ocrText) {
    const env = serverEnv();
    if (!env.OLLAMA_URL) return null;
    const res = await fetch(new URL("/api/chat", env.OLLAMA_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        format: MODEL_RECEIPT_JSON_SCHEMA,
        options: { temperature: 0 },
        messages: [
          {
            role: "user",
            content: userPrompt(ocrText),
            ...(isImage(file) ? { images: [file.data.toString("base64")] } : {}),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama status ${res.status}`);
    const body = (await res.json()) as { message?: { content?: string } };
    return parseModelReceipt(body.message?.content ?? "");
  },
};

export const geminiStructurer: ReceiptStructurer = {
  name: "gemini",
  available: () => Boolean(serverEnv().GEMINI_API_KEY),
  async structure(file, ocrText) {
    const env = serverEnv();
    if (!env.GEMINI_API_KEY) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              ...(file.mimeType !== "image/heic"
                ? [
                    {
                      inline_data: { mime_type: file.mimeType, data: file.data.toString("base64") },
                    },
                  ]
                : []),
              { text: userPrompt(ocrText) },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: MODEL_RECEIPT_JSON_SCHEMA,
        },
      }),
    });
    if (!res.ok) throw new Error(`gemini status ${res.status}`);
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return parseModelReceipt(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  },
};

const STRUCTURERS = { ollama: ollamaStructurer, gemini: geminiStructurer } as const;

/** Which optional structurers this deployment can offer (configured on the server). */
export function availableStructurers(): Record<"ollama" | "gemini", boolean> {
  return { ollama: ollamaStructurer.available(), gemini: geminiStructurer.available() };
}

/** Runs the chosen model; any failure (timeout, bad JSON, HTTP error) returns null. */
export async function structureWithModel(
  name: ReceiptStructurerName,
  file: StoredFile,
  ocrText: string,
): Promise<ParsedReceipt | null> {
  if (name === "rules") return null;
  const structurer = STRUCTURERS[name];
  if (!structurer.available()) return null;
  try {
    return await structurer.structure(file, ocrText);
  } catch (e) {
    console.warn(`[structurer:${name}] échec`, e instanceof Error ? e.name : "unknown");
    return null;
  }
}
