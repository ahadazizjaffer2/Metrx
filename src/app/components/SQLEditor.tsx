"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { getDuckDBClient } from "@/app/lib/duckdb/db-client";
import type { SchemaColumn, AdditionalTable } from "@/app/lib/duckdb/db-client";

// ── Constants ─────────────────────────────────────────────────────────────────

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "HAVING",
  "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "FULL JOIN", "CROSS JOIN",
  "ON", "AS", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX",
  "AND", "OR", "NOT", "IN", "LIKE", "ILIKE", "BETWEEN",
  "IS NULL", "IS NOT NULL", "ASC", "DESC",
  "UNION", "UNION ALL", "INTERSECT", "EXCEPT",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  "CAST", "COALESCE", "NULLIF", "DATE_TRUNC", "STRFTIME",
  "INSERT INTO", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE", "DROP TABLE",
  "WITH", "QUALIFY", "WINDOW", "OVER", "PARTITION BY", "ROW_NUMBER",
];

// ── Colour helpers (matches DataPreviewTable) ─────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  VARCHAR:   "bg-violet-500/15 text-violet-300 border-violet-500/20",
  INTEGER:   "bg-sky-500/15 text-sky-300 border-sky-500/20",
  BIGINT:    "bg-sky-500/15 text-sky-300 border-sky-500/20",
  HUGEINT:   "bg-sky-500/15 text-sky-300 border-sky-500/20",
  DOUBLE:    "bg-teal-500/15 text-teal-300 border-teal-500/20",
  FLOAT:     "bg-teal-500/15 text-teal-300 border-teal-500/20",
  BOOLEAN:   "bg-amber-500/15 text-amber-300 border-amber-500/20",
  DATE:      "bg-rose-500/15 text-rose-300 border-rose-500/20",
  TIMESTAMP: "bg-rose-500/15 text-rose-300 border-rose-500/20",
};

function typeColor(t: string): string {
  const base = t.toUpperCase().split("(")[0].trim();
  return TYPE_COLORS[base] ?? "bg-zinc-700/50 text-zinc-400 border-zinc-600/30";
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueryState {
  rows:       Record<string, unknown>[];
  columns:    string[];
  rowCount:   number;
  durationMs: number;
  error:      string | null;
}

interface Props {
  schema:           SchemaColumn[];
  tableName:        string;
  additionalTables: AdditionalTable[];
}

// ── Sidebar table section ─────────────────────────────────────────────────────

function SidebarTable({
  tableName,
  schema,
  accentClass,
}: {
  tableName:   string;
  schema:      SchemaColumn[];
  accentClass: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-1 px-2">
      {/* Table header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg
                   hover:bg-zinc-800/40 transition-colors mb-0.5"
      >
        <svg
          className={`w-2.5 h-2.5 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border
                         text-[10px] font-medium font-mono truncate ${accentClass}`}>
          {tableName}
        </div>
      </button>

      {/* Column list */}
      {open && (
        <div className="space-y-px pl-4">
          {schema.map((col) => (
            <div
              key={col.column_name}
              className="flex items-center justify-between gap-2
                         px-2 py-1 rounded-lg hover:bg-zinc-800/50 cursor-default"
            >
              <span className="text-zinc-300 text-[11px] font-mono truncate">
                {col.column_name}
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0
                               ${typeColor(col.column_type)}`}>
                {col.column_type.split("(")[0]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SQLEditor({ schema, tableName, additionalTables }: Props) {
  const defaultSql = `SELECT * FROM "${tableName}" LIMIT 100`;

  const [running,     setRunning]     = useState(false);
  const [queryResult, setQueryResult] = useState<QueryState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Keep mutable refs so keyboard shortcut always sees current values
  const sqlRef     = useRef(defaultSql);
  const runningRef = useRef(false);
  const disposeRef = useRef<{ dispose: () => void } | null>(null);
  const monacoRef  = useRef<Monaco | null>(null);

  // ── Run query ───────────────────────────────────────────────────────────────

  const runQuery = useCallback(async (sqlToRun: string) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const start = performance.now();
    try {
      const rows     = await getDuckDBClient().query(sqlToRun);
      const elapsed  = Math.round(performance.now() - start);
      const columns  = rows.length > 0 ? Object.keys(rows[0]) : [];
      setQueryResult({ rows, columns, rowCount: rows.length, durationMs: elapsed, error: null });
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);
      setQueryResult({
        rows: [], columns: [], rowCount: 0, durationMs: elapsed,
        error: err instanceof Error ? err.message : "Query failed",
      });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, []);

  // Stable ref so the editor-mounted command always has the latest runQuery
  const runQueryRef = useRef(runQuery);
  useEffect(() => { runQueryRef.current = runQuery; }, [runQuery]);

  // Cleanup completion provider on unmount
  useEffect(() => () => { disposeRef.current?.dispose(); }, []);

  // ── Monaco setup ────────────────────────────────────────────────────────────

  // Registers (or re-registers) the completion provider — called on mount and
  // whenever schema / tableName / additionalTables changes.
  const registerCompletions = useCallback((monaco: Monaco) => {
    disposeRef.current?.dispose();
    disposeRef.current = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "\n"],
      provideCompletionItems: (model: editor.ITextModel, position: Position) => {
        const word  = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber:   position.lineNumber,
          startColumn:     word.startColumn,
          endColumn:       word.endColumn,
        };

        // Primary table + its columns
        const primarySuggestions = [
          {
            label:         tableName,
            kind:          monaco.languages.CompletionItemKind.Class,
            insertText:    `"${tableName}"`,
            documentation: "Primary table",
            detail:        "table",
            range,
            sortText:      "0a",
          },
          ...schema.map((col) => ({
            label:         col.column_name,
            kind:          monaco.languages.CompletionItemKind.Field,
            insertText:    col.column_name,
            documentation: `"${tableName}".${col.column_name} — ${col.column_type}`,
            detail:        col.column_type,
            range,
            sortText:      "1a",
          })),
        ];

        // Additional tables + their columns
        const additionalSuggestions = additionalTables.flatMap((t) => [
          {
            label:         t.tableName,
            kind:          monaco.languages.CompletionItemKind.Class,
            insertText:    `"${t.tableName}"`,
            documentation: `${t.fileName} · ${t.rowCount.toLocaleString()} rows`,
            detail:        "table",
            range,
            sortText:      "0b",
          },
          ...t.schema.map((col) => ({
            label:         col.column_name,
            kind:          monaco.languages.CompletionItemKind.Field,
            insertText:    col.column_name,
            documentation: `"${t.tableName}".${col.column_name} — ${col.column_type}`,
            detail:        `${t.tableName}.${col.column_type}`,
            range,
            sortText:      "1b",
          })),
        ]);

        const keywordSuggestions = SQL_KEYWORDS.map((kw) => ({
          label:      kw,
          kind:       monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          sortText:   "2",
        }));

        return { suggestions: [...primarySuggestions, ...additionalSuggestions, ...keywordSuggestions] };
      },
    });
  }, [schema, tableName, additionalTables]);

  // Re-register whenever deps change (after initial mount)
  useEffect(() => {
    if (monacoRef.current) registerCompletions(monacoRef.current);
  }, [registerCompletions]);

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    monacoRef.current = monaco;

    monaco.editor.defineTheme("metrx-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword.sql",  foreground: "a78bfa", fontStyle: "bold" },
        { token: "string.sql",   foreground: "6ee7b7" },
        { token: "number",       foreground: "7dd3fc" },
        { token: "comment.sql",  foreground: "52525b", fontStyle: "italic" },
        { token: "operator.sql", foreground: "e4e4e7" },
        { token: "identifier",   foreground: "f4f4f5" },
        { token: "delimiter",    foreground: "71717a" },
      ],
      colors: {
        "editor.background":                    "#09090b",
        "editor.foreground":                    "#e4e4e7",
        "editor.lineHighlightBackground":       "#18181b",
        "editor.lineHighlightBorder":           "#18181b",
        "editorLineNumber.foreground":          "#3f3f46",
        "editorLineNumber.activeForeground":    "#a1a1aa",
        "editor.selectionBackground":           "#3730a380",
        "editor.selectionHighlightBackground":  "#312e8150",
        "editorCursor.foreground":              "#a78bfa",
        "editorIndentGuide.background1":        "#27272a",
        "editorIndentGuide.activeBackground1":  "#3f3f46",
        "editorSuggestWidget.background":       "#18181b",
        "editorSuggestWidget.border":           "#3f3f46",
        "editorSuggestWidget.foreground":       "#e4e4e7",
        "editorSuggestWidget.selectedBackground":"#27272a",
        "editorSuggestWidget.highlightForeground":"#a78bfa",
        "editorWidget.background":              "#18181b",
        "editorWidget.border":                  "#3f3f46",
        "input.background":                     "#27272a",
        "input.border":                         "#3f3f46",
        "scrollbar.shadow":                     "#00000000",
        "scrollbarSlider.background":           "#3f3f4640",
        "scrollbarSlider.hoverBackground":      "#3f3f4680",
        "scrollbarSlider.activeBackground":     "#52525b80",
      },
    });

    registerCompletions(monaco);
  }, [registerCompletions]);

  type IStandaloneEditor = { addCommand: (key: number, fn: () => void) => void };

  const handleEditorMount = useCallback((editor: IStandaloneEditor, monaco: Monaco) => {
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => runQueryRef.current(sqlRef.current),
    );
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-4 h-full">

      {/* ── Schema sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={[
          "shrink-0 flex flex-col border border-zinc-800 rounded-xl",
          "overflow-hidden transition-all duration-200 bg-zinc-900/30",
          sidebarOpen ? "w-52" : "w-9",
        ].join(" ")}
      >
        {/* Toggle header */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Collapse schema" : "Expand schema"}
          className="flex items-center gap-2 px-2.5 py-2.5 shrink-0
                     border-b border-zinc-800 bg-zinc-900/80
                     hover:bg-zinc-800/60 transition-colors
                     text-zinc-400 hover:text-zinc-200"
        >
          <svg
            className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${sidebarOpen ? "" : "rotate-180"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {sidebarOpen && (
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              Schema
            </span>
          )}
        </button>

        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto py-2 min-h-0">

            {/* ── Primary table ── */}
            <SidebarTable
              tableName={tableName}
              schema={schema}
              accentClass="bg-violet-500/10 border-violet-500/20 text-violet-300"
            />

            {/* ── Additional tables ── */}
            {additionalTables.map((t) => (
              <SidebarTable
                key={t.tableName}
                tableName={t.tableName}
                schema={t.schema}
                accentClass="bg-sky-500/10 border-sky-500/20 text-sky-300"
              />
            ))}
          </div>
        )}
      </aside>

      {/* ── Editor + results ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">

        {/* Monaco editor */}
        <div className="rounded-xl border border-zinc-800 overflow-hidden shrink-0"
          style={{ height: 220 }}>
          <Editor
            defaultLanguage="sql"
            defaultValue={defaultSql}
            theme="metrx-dark"
            beforeMount={handleBeforeMount}
            onMount={(editor, monaco) =>
              handleEditorMount(
                editor as unknown as IStandaloneEditor,
                monaco,
              )
            }
            onChange={(val) => { sqlRef.current = val ?? ""; }}
            options={{
              minimap:               { enabled: false },
              fontSize:              13,
              lineNumbers:           "on",
              scrollBeyondLastLine:  false,
              wordWrap:              "off",
              fontFamily:            "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
              fontLigatures:         true,
              padding:               { top: 12, bottom: 12 },
              suggestOnTriggerCharacters: true,
              quickSuggestions:      { other: true, comments: false, strings: false },
              tabSize:               2,
              renderLineHighlight:   "gutter",
              contextmenu:           false,
              overviewRulerBorder:   false,
              hideCursorInOverviewRuler: true,
              renderWhitespace:      "none",
              scrollbar: {
                vertical:              "auto",
                horizontal:            "auto",
                verticalScrollbarSize:  6,
                horizontalScrollbarSize: 6,
              },
            }}
          />
        </div>

        {/* Run toolbar */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => runQuery(sqlRef.current)}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-lg
                       bg-violet-600 hover:bg-violet-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       text-white text-sm font-medium transition-colors"
          >
            {running ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54
                     6.348a1.125 1.125 0 010 1.971l-11.54
                     6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
            )}
            {running ? "Running…" : "Run"}
          </button>

          <span className="text-xs text-zinc-600">⌘/Ctrl + Enter</span>

          {/* Stats */}
          {queryResult && !queryResult.error && (
            <div className="ml-auto flex items-center gap-2">
              {[
                { label: "Rows", value: queryResult.rowCount.toLocaleString() },
                { label: "Time", value: `${queryResult.durationMs} ms` },
              ].map(({ label, value }) => (
                <div key={label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                             bg-zinc-900 border border-zinc-800 text-xs">
                  <span className="text-zinc-500">{label}</span>
                  <span className="text-zinc-200 font-medium font-mono">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error banner */}
        {queryResult?.error && (
          <div className="shrink-0 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
            <p className="text-red-400 text-sm font-medium">Query error</p>
            <p className="text-red-300/70 text-xs mt-1 font-mono break-words">
              {queryResult.error}
            </p>
          </div>
        )}

        {/* Results table */}
        {queryResult && !queryResult.error && (
          <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800">
            {queryResult.rows.length === 0 ? (
              <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                No rows returned.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-sm">
                    <th className="px-4 py-2.5 text-left text-zinc-600 font-normal w-10">#</th>
                    {queryResult.columns.map((col) => (
                      <th key={col}
                        className="px-4 py-2.5 text-left text-zinc-400 font-medium
                                   uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {queryResult.rows.map((row, i) => (
                    <tr key={i} className="bg-zinc-950 hover:bg-zinc-900/40 transition-colors">
                      <td className="px-4 py-2.5 text-zinc-700 font-mono">{i + 1}</td>
                      {queryResult.columns.map((col) => (
                        <td key={col}
                          className="px-4 py-2.5 text-zinc-300 font-mono
                                     whitespace-nowrap max-w-[260px] truncate"
                          title={String(row[col] ?? "")}>
                          {row[col] === null
                            ? <span className="text-zinc-700 italic">null</span>
                            : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
