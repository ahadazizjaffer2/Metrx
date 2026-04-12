"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadEngine, streamInsights, generateSQL, fixSQL, streamAnswer,
  isEngineLoaded, isEngineLoading, getLoadProgress, subscribeToProgress,
  isWebGPUSupported, MODEL_SIZE,
  type LoadProgress,
} from "@/app/lib/webllm";
import { getDuckDBClient } from "@/app/lib/duckdb/db-client";
import type { SchemaColumn } from "@/app/lib/duckdb/db-client";
import { isNumericType, isDatetimeType, isStringType } from "@/app/lib/chartUtils";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  schema:          SchemaColumn[];
  totalRows:       number;
  fileName:        string;
  tableName:       string;
  onSwitchToSQL?: () => void;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AIState = "idle" | "loading" | "insights" | "ready";

type ThinkingStep = "sql" | "running" | "fixing" | "answering" | null;

type Message = {
  id:        string;
  role:      "user" | "assistant";
  content:   string;
  streaming?: boolean;
  // Table shown only when the SQL returned multiple rows
  rows?:     Record<string, unknown>[] | null;
  error?:    string;
};

const uid = () => Math.random().toString(36).slice(2, 9);

// ─── Schema-aware suggested questions ────────────────────────────────────────

function buildSuggestions(schema: SchemaColumn[]): string[] {
  const numCols  = schema.filter(c => isNumericType(c.column_type));
  const dateCols = schema.filter(c =>
    isDatetimeType(c.column_type) ||
    ["date", "time", "timestamp", "at", "on"].some(k =>
      c.column_name.toLowerCase().includes(k)
    )
  );
  const strCols  = schema.filter(c => isStringType(c.column_type));
  const q: string[] = [];

  if (numCols.length > 0)
    q.push(`What is the average ${numCols[0].column_name}?`);

  if (dateCols.length > 0 && numCols.length > 0)
    q.push(`When did ${numCols[0].column_name} reach its highest value?`);
  else if (numCols.length > 1)
    q.push(`How many rows have ${numCols[0].column_name} above its average?`);

  if (numCols.length > 0)
    q.push(`What is the minimum and maximum ${numCols[0].column_name}?`);
  else if (strCols.length > 0)
    q.push(`What are the unique values of ${strCols[0].column_name}?`);

  // Fill remaining with generic fallbacks
  const fallbacks = [
    "How many total rows are there?",
    "Show me a summary of the data",
    "What columns are available?",
  ];
  while (q.length < 3) q.push(fallbacks[q.length]);

  return q.slice(0, 3);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypingCursor() {
  return (
    <span className="inline-block w-0.5 h-3.5 bg-violet-400 ml-0.5 animate-pulse align-middle" />
  );
}

function ThinkingDots() {
  return (
    <span className="flex gap-1 items-center py-0.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols    = Object.keys(rows[0]);
  const preview = rows.slice(0, 8);

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-700/40">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-zinc-800/60 border-b border-zinc-700/40">
            {cols.map(c => (
              <th key={c} className="px-3 py-2 text-left text-zinc-500 font-medium
                                     uppercase tracking-wider whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {preview.map((row, i) => (
            <tr key={i} className="hover:bg-zinc-800/20 transition-colors">
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-zinc-300 font-mono
                                       whitespace-nowrap max-w-[200px] truncate">
                  {row[c] === null
                    ? <span className="text-zinc-600 italic">null</span>
                    : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 8 && (
        <p className="text-[10px] text-zinc-600 px-3 py-2 border-t border-zinc-800/60">
          Showing 8 of {rows.length.toLocaleString()} rows
        </p>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser     = msg.role === "user";
  const isThinking = msg.streaming && !msg.content;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center
                        text-[10px] font-bold mt-0.5
                        ${isUser
                          ? "bg-zinc-700 text-zinc-300"
                          : "bg-violet-500/20 text-violet-300"}`}>
        {isUser ? "U" : "✦"}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                        ${isUser
                          ? "bg-zinc-800 text-zinc-200 rounded-tr-sm"
                          : "bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-tl-sm"}`}>

        {isThinking ? (
          <ThinkingDots />
        ) : (
          <>
            {msg.content}
            {msg.streaming && <TypingCursor />}
          </>
        )}

        {/* Error */}
        {msg.error && !msg.streaming && (
          <p className="mt-2 text-xs text-red-400 font-mono">{msg.error}</p>
        )}

        {/* Result table — only for multi-row results */}
        {msg.rows && msg.rows.length > 0 && !msg.streaming && (
          <ResultTable rows={msg.rows} />
        )}
      </div>
    </div>
  );
}

// ─── Thinking status badge ────────────────────────────────────────────────────

function ThinkingBadge({ step }: { step: ThinkingStep }) {
  if (!step) return null;

  const labels: Record<NonNullable<ThinkingStep>, string> = {
    sql:       "Generating query…",
    running:   "Running query…",
    fixing:    "Fixing query error…",
    answering: "Formulating answer…",
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full
                    bg-zinc-800/80 border border-zinc-700/50 w-fit text-[11px] text-zinc-500">
      <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse shrink-0" />
      {labels[step]}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AIAssistant({ schema, totalRows, fileName, tableName, onSwitchToSQL }: Props) {
  const [aiState,  setAIState]  = useState<AIState>(isEngineLoaded() ? "ready" : "idle");
  const [loadProg, setLoadProg] = useState<LoadProgress>({ progress: 0, text: "" });
  const [insights, setInsights] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState("");
  const [isBusy,   setIsBusy]   = useState(false);
  const [thinking, setThinking] = useState<ThinkingStep>(null);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const suggestions = buildSuggestions(schema);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, insights]);

  // ── Insights ──────────────────────────────────────────────────────────────

  const kickInsights = useCallback(async () => {
    setInsights("");
    setMessages([]);
    setAIState("insights");
    let full = "";
    try {
      for await (const chunk of streamInsights(schema, totalRows, fileName)) {
        full += chunk;
        setInsights(full);
      }
    } catch (err) {
      console.error("[AIAssistant] Insights failed:", err);
    }
    setAIState("ready");
  }, [schema, totalRows, fileName]);

  // Re-run insights if engine already loaded when a new file is dropped
  useEffect(() => {
    if (isEngineLoaded() && aiState === "idle") {
      setAIState("ready");
      kickInsights();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  // Reconnect to an in-progress engine download when this component remounts
  // mid-download (e.g. user switched to another tab while the model was loading).
  useEffect(() => {
    if (isEngineLoaded() || !isEngineLoading()) return;

    setAIState("loading");
    setLoadProg(getLoadProgress());
    const unsub = subscribeToProgress(setLoadProg);

    loadEngine()
      .then(() => { if (mountedRef.current) kickInsights(); })
      .catch((err) => {
        console.error("[AIAssistant] Engine reconnect failed:", err);
        if (mountedRef.current) setAIState("idle");
      })
      .finally(() => unsub());

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Enable ────────────────────────────────────────────────────────────────

  const handleEnable = useCallback(async () => {
    setAIState("loading");
    const unsub = subscribeToProgress(setLoadProg);
    try {
      await loadEngine();
      if (mountedRef.current) kickInsights();
    } catch (err) {
      console.error("[AIAssistant] Engine load failed:", err);
      if (mountedRef.current) setAIState("idle");
    } finally {
      unsub();
    }
  }, [kickInsights]);

  // ── Two-pass chat send ────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isBusy) return;

    setInput("");
    setIsBusy(true);

    const userMsg: Message     = { id: uid(), role: "user",      content: text };
    const assistantId          = uid();
    const placeholder: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages(prev => [...prev, userMsg, placeholder]);

    try {
      // ── Pass 1: generate SQL (hidden from user) ──────────────────────────
      setThinking("sql");
      const sql = await generateSQL(text, schema, totalRows, fileName, tableName);

      let queryRows: Record<string, unknown>[] | null = null;

      if (sql) {
        // ── Execute SQL (with one automatic retry on error) ───────────────
        setThinking("running");
        try {
          queryRows = await getDuckDBClient().query(sql);
        } catch (firstErr) {
          const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          console.warn("[AIAssistant] SQL error on first attempt, retrying:", errMsg);

          // Pass 1b: ask the model to fix its own mistake
          setThinking("fixing");
          try {
            const repairedSQL = await fixSQL(sql, errMsg, schema, totalRows, fileName, tableName);
            if (repairedSQL) {
              setThinking("running");
              queryRows = await getDuckDBClient().query(repairedSQL);
            } else {
              queryRows = [];
            }
          } catch (retryErr) {
            console.warn("[AIAssistant] SQL error after retry:", retryErr);
            queryRows = [];
          }
        }
      }

      // ── Pass 2: stream natural language answer ───────────────────────────
      setThinking("answering");
      let answer = "";

      for await (const chunk of streamAnswer(text, queryRows, schema, totalRows, fileName)) {
        answer += chunk;
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: answer } : m)
        );
      }

      // Attach result table only when there are multiple rows
      const showTable = queryRows !== null && queryRows.length > 1;

      setMessages(prev =>
        prev.map(m => m.id === assistantId
          ? { ...m, streaming: false, rows: showTable ? queryRows : null }
          : m
        )
      );
    } catch (err) {
      console.error("[AIAssistant] Chat failed:", err);
      setMessages(prev =>
        prev.map(m => m.id === assistantId
          ? { ...m, content: "Something went wrong. Please try again.", streaming: false }
          : m
        )
      );
    }

    setThinking(null);
    setIsBusy(false);
    inputRef.current?.focus();
  }, [input, isBusy, schema, totalRows, fileName]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── IDLE ── */}
      {aiState === "idle" && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-7">
          <div className="flex items-start gap-5">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20
                            flex items-center justify-center text-violet-400 text-lg shrink-0">
              ✦
            </div>
            <div className="flex-1">
              <h3 className="text-zinc-200 font-semibold text-sm mb-1">Ask your data anything</h3>
              <p className="text-zinc-500 text-xs leading-relaxed mb-4">
                A private AI assistant that runs entirely inside your browser —
                no account, no internet connection required, and your data never
                leaves your device. Just ask a question in plain English.
              </p>

              {/* ── Three disclosure callouts ── */}
              <div className="flex flex-col gap-2 mb-5">
                {[
                  {
                    icon: (
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021
                             18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                    ),
                    text: `${MODEL_SIZE} one-time download`,
                    color: "text-amber-400",
                  },
                  {
                    icon: (
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3
                             0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25
                             2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25
                             3h13.5A2.25 2.25 0 0121 5.25z" />
                      </svg>
                    ),
                    text: "Requires Chrome or Edge 113+",
                    color: "text-sky-400",
                  },
                  {
                    icon: (
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75
                             11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25
                             2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25
                             2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    ),
                    text: "Model runs entirely on your device after download",
                    color: "text-emerald-400",
                  },
                ].map(({ icon, text, color }) => (
                  <div key={text} className={`flex items-center gap-2 text-[11px] ${color}`}>
                    {icon}
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              {/* ── Action row ── */}
              {!isWebGPUSupported() ? (
                <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-3
                                bg-zinc-900/50 text-xs text-zinc-500 leading-relaxed">
                  <span className="text-zinc-400 font-medium">WebGPU not detected.</span>{" "}
                  The on-device AI requires WebGPU, available in Chrome 113+ and Edge 113+.
                  Open metrx in one of those browsers to enable it.
                  {onSwitchToSQL && (
                    <>
                      {" "}You can still explore your data with the{" "}
                      <button
                        onClick={onSwitchToSQL}
                        className="text-violet-400 hover:text-violet-300 underline
                                   underline-offset-2 transition-colors"
                      >
                        SQL editor
                      </button>.
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleEnable}
                    className="px-4 py-2 rounded-lg border border-violet-500/50
                               text-violet-400 hover:bg-violet-500/10 hover:border-violet-400
                               text-xs font-medium transition-colors"
                  >
                    Enable AI →
                  </button>
                  {onSwitchToSQL && (
                    <button
                      onClick={onSwitchToSQL}
                      className="text-[11px] text-zinc-600 hover:text-zinc-400
                                 underline underline-offset-2 transition-colors"
                    >
                      Skip — use SQL editor instead
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {aiState === "loading" && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent
                            rounded-full animate-spin shrink-0" />
            <p className="text-zinc-300 text-sm font-medium">Setting up AI assistant…</p>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-2 overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round(loadProg.progress * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-zinc-600">
            <span className="truncate max-w-[80%]">{loadProg.text || "Initialising…"}</span>
            <span>{Math.round(loadProg.progress * 100)}%</span>
          </div>
          <p className="text-[11px] text-zinc-700 mt-3">
            This only happens once — the model is cached in your browser after this.
          </p>
        </div>
      )}

      {/* ── INSIGHTS + CHAT ── */}
      {(aiState === "insights" || aiState === "ready") && (
        <>
          {/* Dataset snapshot */}
          <div className="rounded-2xl border border-violet-500/15 bg-violet-500/5 p-5">
            <p className="text-[10px] text-violet-500 uppercase tracking-widest mb-3">
              Dataset snapshot
            </p>

            {/* Skeleton shown while waiting for the first token */}
            {aiState === "insights" && !insights && (
              <div className="space-y-2.5 animate-pulse">
                <div className="h-3 bg-violet-500/10 rounded-full w-full" />
                <div className="h-3 bg-violet-500/10 rounded-full w-[88%]" />
                <div className="h-3 bg-violet-500/10 rounded-full w-[72%]" />
              </div>
            )}

            {insights && (
              <p className="text-zinc-300 text-sm leading-7 whitespace-pre-line">
                {insights}
                {aiState === "insights" && <TypingCursor />}
              </p>
            )}
          </div>

          {/* Chat interface */}
          {aiState === "ready" && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 flex flex-col">

              {/* Message list */}
              {messages.length > 0 && (
                <div className="flex flex-col gap-4 p-5 max-h-[60vh] overflow-y-auto">
                  {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
                  {/* Status badge while processing */}
                  {thinking && (
                    <div className="flex justify-start pl-9">
                      <ThinkingBadge step={thinking} />
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}

              {/* Empty state with schema-aware suggestions */}
              {messages.length === 0 && (
                <div className="px-5 pt-5 pb-3">
                  <p className="text-zinc-600 text-xs mb-3">
                    Ask anything — get a direct answer, not a table.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map(q => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); inputRef.current?.focus(); }}
                        className="text-[11px] px-2.5 py-1 rounded-full bg-zinc-800
                                   border border-zinc-700 text-zinc-400
                                   hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input bar */}
              <div className="flex gap-2 p-3 border-t border-zinc-800">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask your data… (Enter to send)"
                  disabled={isBusy}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2
                             text-sm text-zinc-200 placeholder-zinc-600 resize-none
                             focus:outline-none focus:border-violet-500/50
                             disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isBusy}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500
                             text-white text-xs font-medium transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {isBusy ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-white/40 border-t-white
                                       rounded-full animate-spin" />
                      …
                    </span>
                  ) : "Send"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
