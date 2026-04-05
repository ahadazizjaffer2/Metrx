// Runs Phi-3.5-mini (2.4 GB) entirely in the browser via WebGPU.
// No API key, no server, no data upload. Model is downloaded once from the
// Hugging Face CDN and cached in the browser's Cache API forever after.

import type { MLCEngine, InitProgressReport, ChatCompletion } from "@mlc-ai/web-llm";
import type { SchemaColumn } from "./duckdb/db-client";

// ─── Config ───────────────────────────────────────────────────────────────────

export const MODEL_ID   = "Phi-3.5-mini-instruct-q4f16_1-MLC";
export const MODEL_SIZE = "2.4 GB";

export type LoadProgress = {
  progress: number; // 0–1
  text:     string;
};

// ─── Singleton engine ─────────────────────────────────────────────────────────

let _engine:      MLCEngine | null = null;
let _loadPromise: Promise<MLCEngine> | null = null;

// Module-level progress state so any component that remounts mid-download can
// immediately restore the current progress and subscribe to future updates.
let _loadProgress: LoadProgress = { progress: 0, text: "" };
const _progressListeners = new Set<(p: LoadProgress) => void>();

export function isEngineLoaded(): boolean {
  return _engine !== null;
}

export function isEngineLoading(): boolean {
  return _loadPromise !== null && _engine === null;
}

export function getLoadProgress(): LoadProgress {
  return _loadProgress;
}

/** Subscribe to progress updates. Returns an unsubscribe function. */
export function subscribeToProgress(cb: (p: LoadProgress) => void): () => void {
  _progressListeners.add(cb);
  return () => { _progressListeners.delete(cb); };
}

export function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function loadEngine(): Promise<void> {
  if (_engine) return;

  if (!_loadPromise) {
    _loadPromise = import("@mlc-ai/web-llm")
      .then(({ CreateMLCEngine }) =>
        CreateMLCEngine(MODEL_ID, {
          initProgressCallback: (r: InitProgressReport) => {
            _loadProgress = { progress: r.progress, text: r.text };
            _progressListeners.forEach(cb => cb(_loadProgress));
          },
        }),
      )
      .then(engine => {
        _engine = engine as MLCEngine;
        return _engine;
      });
  }

  await _loadPromise;
}

// ─── Streaming type ───────────────────────────────────────────────────────────

type StreamChunk = { choices: { delta: { content?: string } }[] };

// ─── Pass 1 — SQL generation ──────────────────────────────────────────────────

/**
 * Converts the user's question into a raw DuckDB SQL query.
 * Non-streaming — returns the full SQL string (or null if SQL isn't needed).
 * The user never sees this call; it runs silently before Pass 2.
 */
export async function generateSQL(
  question:  string,
  schema:    SchemaColumn[],
  totalRows: number,
  fileName:  string,
): Promise<string | null> {
  if (!_engine) throw new Error("Engine not loaded");

  const cols = schema
    .map(c => `${c.column_name} (${c.column_type})`)
    .join(", ");

  const reply = (await _engine.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          `You are a SQL generator for DuckDB.\n` +
          `Table: _metrx_ingested  Rows: ${totalRows.toLocaleString()}  File: "${fileName}"\n` +
          `Columns: ${cols}\n\n` +
          `Rules:\n` +
          `- Output ONLY the raw SQL query — no markdown, no backticks, no explanation\n` +
          `- If the question cannot be answered with SQL, output exactly: NONE\n` +
          `- Use double-quotes for column names with spaces\n` +
          `- Always add LIMIT 100 to SELECT queries that return rows`,
      },
      { role: "user", content: question },
    ],
    temperature: 0,
    max_tokens:  200,
    stream:      false,
  })) as ChatCompletion;

  const raw = reply.choices[0]?.message?.content?.trim() ?? "";

  if (!raw || raw.toUpperCase() === "NONE") return null;

  // Strip any accidental markdown fences the model might have added anyway
  return raw.replace(/^```sql\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

// ─── Pass 1b — SQL auto-repair ────────────────────────────────────────────────

/**
 * Called when DuckDB rejects the generated SQL.
 * Feeds the broken query + the exact error message back to the model and asks
 * for a corrected version. One retry catches ~80% of character-level typos
 * (e.g. BETWE0N → BETWEEN) and simple syntax mistakes.
 */
export async function fixSQL(
  brokenSQL:    string,
  errorMessage: string,
  schema:       SchemaColumn[],
  totalRows:    number,
  fileName:     string,
): Promise<string | null> {
  if (!_engine) throw new Error("Engine not loaded");

  const cols = schema
    .map(c => `${c.column_name} (${c.column_type})`)
    .join(", ");

  const reply = (await _engine.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          `You are a SQL debugger for DuckDB.\n` +
          `Table: _metrx_ingested  Rows: ${totalRows.toLocaleString()}  File: "${fileName}"\n` +
          `Columns: ${cols}\n\n` +
          `Rules:\n` +
          `- Output ONLY the corrected SQL query — no markdown, no backticks, no explanation\n` +
          `- Fix every syntax error shown in the error message\n` +
          `- Do not change the intent of the query`,
      },
      {
        role: "user",
        content:
          `The following SQL failed:\n${brokenSQL}\n\n` +
          `DuckDB error: ${errorMessage}\n\n` +
          `Return the corrected SQL:`,
      },
    ],
    temperature: 0,
    max_tokens:  200,
    stream:      false,
  })) as ChatCompletion;

  const raw = reply.choices[0]?.message?.content?.trim() ?? "";
  if (!raw || raw.toUpperCase() === "NONE") return null;

  return raw.replace(/^```sql\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

// ─── Pass 2 — Natural language answer ─────────────────────────────────────────

/**
 * Streams a plain-English answer to the user's question.
 *
 * When queryRows is provided (SQL was run):
 *   - Scalar result  (1 row, 1 col) → one sentence with the exact number
 *   - Multi-row result              → one sentence summary ("X rows match…")
 * When queryRows is null (no SQL needed):
 *   - Answers conversationally from schema context only
 */
export async function* streamAnswer(
  question:   string,
  queryRows:  Record<string, unknown>[] | null,
  schema:     SchemaColumn[],
  totalRows:  number,
  fileName:   string,
): AsyncGenerator<string> {
  if (!_engine) throw new Error("Engine not loaded");

  let dataContext: string;

  if (queryRows === null) {
    // Conversational / schema-only question
    const cols = schema.map(c => `${c.column_name} (${c.column_type})`).join(", ");
    dataContext =
      `Dataset: "${fileName}", ${totalRows.toLocaleString()} rows, columns: ${cols}\n` +
      `No data query was needed.`;
  } else if (queryRows.length === 0) {
    dataContext = `SQL query returned 0 rows.`;
  } else {
    // Send a compact sample — never more than 5 rows to keep the prompt small
    const sample   = queryRows.slice(0, 5);
    const rowCount = queryRows.length;
    dataContext =
      `SQL query returned ${rowCount} row${rowCount !== 1 ? "s" : ""}.\n` +
      `Result sample: ${JSON.stringify(sample)}`;
  }

  const stream = (await _engine.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          `You are a data analyst giving a direct verbal answer.\n` +
          `Rules:\n` +
          `- Answer in 1-2 sentences maximum\n` +
          `- Use the exact numbers from the result\n` +
          `- Never say "SQL", "query", "database", or "table"\n` +
          `- Speak naturally, like telling a colleague the answer\n` +
          `- If 0 rows: say no matching records were found`,
      },
      {
        role: "user",
        content: `Question: "${question}"\n${dataContext}\n\nAnswer:`,
      },
    ],
    temperature: 0.2,
    max_tokens:  120,
    stream:      true,
  })) as AsyncIterable<StreamChunk>;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) yield delta;
  }
}

// ─── Insights ─────────────────────────────────────────────────────────────────

/** Stream a 3-bullet data summary based on schema only (no row values sent). */
export async function* streamInsights(
  schema:    SchemaColumn[],
  totalRows: number,
  fileName:  string,
): AsyncGenerator<string> {
  if (!_engine) throw new Error("Engine not loaded");

  const prompt =
    `Dataset: "${fileName}", ${totalRows.toLocaleString()} rows\n` +
    `Columns: ${schema.map(c => `${c.column_name} (${c.column_type})`).join(", ")}\n\n` +
    `Write exactly 3 bullet points starting with • that describe the most valuable ` +
    `analytical observations about this dataset. What patterns are likely? What ` +
    `questions can it answer? Be specific to these column names. One sentence each.`;

  const stream = (await _engine.chat.completions.create({
    messages:    [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens:  280,
    stream:      true,
  })) as AsyncIterable<StreamChunk>;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) yield delta;
  }
}
