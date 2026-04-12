"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { getDuckDBClient, type LoadFileResult, type AdditionalTable } from "@/app/lib/duckdb/db-client";

// ── Dynamic imports ───────────────────────────────────────────────────────────

const DashboardVisuals = dynamic(() => import("./DashboardVisuals"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-3 py-16 text-zinc-600 text-sm">
      <div className="w-4 h-4 border-2 border-violet-500/50 border-t-violet-400 rounded-full animate-spin shrink-0" />
      Building visualizations…
    </div>
  ),
});

const AIAssistant = dynamic(() => import("./AIAssistant"), {
  ssr: false,
  loading: () => null,
});

const SQLEditor = dynamic(() => import("./SQLEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-3 py-16 text-zinc-600 text-sm">
      <div className="w-4 h-4 border-2 border-violet-500/50 border-t-violet-400 rounded-full animate-spin shrink-0" />
      Loading SQL editor…
    </div>
  ),
});

const DataPreviewTable = dynamic(() => import("./DataPreviewTable"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-3 py-16 text-zinc-600 text-sm">
      <div className="w-4 h-4 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin shrink-0" />
      Loading data…
    </div>
  ),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab          = "overview" | "charts" | "data" | "sql" | "ai";
type UploadStatus = "idle" | "loading" | "error";

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function IconBarChart({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function IconTable({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5" />
    </svg>
  );
}

function IconTerminal({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function IconSparkle({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

// ── Upload screen ─────────────────────────────────────────────────────────────

function UploadScreen({ onSuccess }: { onSuccess: (r: LoadFileResult) => void }) {
  const [status,     setStatus]     = useState<UploadStatus>("idle");
  const [isDragOver, setIsDragOver] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    const supported = [".csv", ".parquet", ".json", ".jsonl"];
    if (!supported.some((ext) => name.endsWith(ext))) {
      setError("Unsupported file type. Please upload a .csv, .parquet, .json, or .jsonl file.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const data = await getDuckDBClient().loadFile(file);
      onSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process file.");
      setStatus("error");
    }
  }, [onSuccess]);

  const isLoading = status === "loading";

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Minimal nav bar */}
      <div className="px-8 py-5 flex items-center">
        <Image src="/Metrx.png" alt="Metrx" width={90} height={25} className="object-contain" priority />
      </div>

      {/* Centered upload area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        {/* Hero text */}
        <div className="w-full max-w-lg text-center mb-10">
          <p className="text-xs font-medium uppercase tracking-widest text-violet-400 mb-3">
            Private data intelligence
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4">
            Your data,<br />your insights.
          </h1>
          <p className="text-zinc-500 text-base leading-relaxed">
            Upload a CSV, Parquet, or JSON file to get instant charts, key metrics,
            and an AI assistant — all running privately on your device.
          </p>
        </div>

        {/* Drop zone */}
        <div className="w-full max-w-md space-y-4">
          <div
            role="button"
            aria-label="Upload data file"
            tabIndex={0}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) processFile(f);
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            onClick={() => !isLoading && inputRef.current?.click()}
            className={[
              "rounded-2xl border-2 border-dashed p-20 text-center",
              "transition-all duration-200 cursor-pointer select-none",
              isDragOver
                ? "border-violet-500 bg-violet-500/10 scale-[1.01] drag-over-ring"
                : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-600 hover:bg-zinc-900/60",
              isLoading ? "pointer-events-none opacity-60" : "",
            ].join(" ")}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.parquet,.json,.jsonl"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processFile(f);
                if (inputRef.current) inputRef.current.value = "";
              }}
            />

            <div className="flex justify-center mb-4">
              <div className={`p-4 rounded-full transition-colors ${isDragOver ? "bg-violet-500/20" : "bg-zinc-800"}`}>
                {isLoading ? (
                  <div className="w-7 h-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className={`w-7 h-7 transition-colors ${isDragOver ? "text-violet-400" : "text-zinc-500"}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                )}
              </div>
            </div>

            <p className="text-zinc-200 font-medium text-base">
              {isLoading ? "Analysing your file…" : isDragOver ? "Release to upload" : "Drop a file here"}
            </p>
            <p className="text-zinc-500 text-sm mt-1.5">
              {isLoading ? "This only takes a moment" : "or click to browse · CSV, Parquet, JSON, JSONL"}
            </p>
          </div>

          {/* Privacy badge */}
          <div className="flex flex-col items-center gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full
                            bg-zinc-900/50 border border-zinc-800 text-xs text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              Processed entirely on your device · zero server upload
            </div>
            <div className="flex items-center gap-2">
              {["CSV", "Parquet", "JSON"].map((fmt) => (
                <span key={fmt}
                  className="px-2.5 py-1 rounded-full bg-zinc-800/60 border border-zinc-700/60
                             text-[11px] text-zinc-500 font-mono">
                  {fmt}
                </span>
              ))}
            </div>
          </div>

          {/* Error */}
          {status === "error" && error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-red-400 text-sm font-medium">Could not read file</p>
              <p className="text-red-300/70 text-xs mt-1">{error}</p>
              <button
                onClick={() => { setStatus("idle"); setError(null); }}
                className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                ← Try another file
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Topbar ────────────────────────────────────────────────────────────────────

function Topbar({
  result,
  additionalTables,
  onReset,
  onAddFile,
  onDropTable,
}: {
  result:            LoadFileResult;
  additionalTables:  AdditionalTable[];
  onReset:           () => void;
  onAddFile:         (file: File) => void;
  onDropTable:       (tableName: string) => void;
}) {
  const addInputRef            = useRef<HTMLInputElement>(null);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddFile = useCallback(async (file: File) => {
    setIsAdding(true);
    try {
      await onAddFile(file);
    } finally {
      setIsAdding(false);
      if (addInputRef.current) addInputRef.current.value = "";
    }
  }, [onAddFile]);

  return (
    <header className="h-16 shrink-0 flex items-center gap-3 px-4 sm:px-6
                       border-b border-zinc-800/60 bg-zinc-950">
      <Image src="/Metrx icon.png" alt="Metrx" width={30} height={30}
        className="object-contain my-2 shrink-0" />

      {/* Scrollable badges row */}
      <div className="flex-1 flex items-center gap-2 min-w-0 overflow-x-auto
                      [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

        {/* Primary file badge */}
        <div className="flex items-stretch gap-0 rounded-lg shrink-0 overflow-hidden
                        bg-zinc-900 border border-zinc-800 text-xs">
          <span className="w-1 bg-emerald-500 shrink-0" />
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="text-zinc-300 font-medium truncate max-w-[120px] sm:max-w-[200px]">
              {result.fileName}
            </span>
            <span className="text-zinc-700 hidden sm:inline">·</span>
            <span className="text-zinc-500 hidden sm:inline">
              {result.totalRows.toLocaleString()} rows
            </span>
          </div>
        </div>

        {/* Additional table pills */}
        {additionalTables.map((t) => (
          <div key={t.tableName}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shrink-0
                       bg-zinc-900/60 border border-zinc-700/60 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
            <span className="text-zinc-400 font-medium font-mono">{t.tableName}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-600">{t.rowCount.toLocaleString()} rows</span>
            <button
              onClick={() => onDropTable(t.tableName)}
              title={`Unload ${t.tableName}`}
              className="ml-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Right-side actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Hidden file input for adding additional files */}
        <input
          ref={addInputRef}
          type="file"
          accept=".csv,.parquet,.json,.jsonl"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleAddFile(f);
          }}
        />

        {/* Add file button */}
        <button
          onClick={() => addInputRef.current?.click()}
          disabled={isAdding}
          title="Add another file as a separate table"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                     text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60
                     border border-zinc-800 hover:border-zinc-700
                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isAdding ? (
            <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-zinc-400
                            rounded-full animate-spin shrink-0" />
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          )}
          <span className="hidden sm:inline">{isAdding ? "Adding…" : "Add file"}</span>
        </button>

        {/* Load new file button */}
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                     text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60
                     border border-zinc-800 hover:border-zinc-700 transition-all"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24"
            stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="hidden sm:inline">Load new file</span>
        </button>
      </div>
    </header>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type TabConfig = { id: Tab; label: string; Icon: React.FC<{ className?: string }> };

const TABS: TabConfig[] = [
  { id: "overview", label: "Overview", Icon: IconGrid     },
  { id: "charts",   label: "Charts",   Icon: IconBarChart },
  { id: "data",     label: "Data",     Icon: IconTable    },
  { id: "sql",      label: "SQL",      Icon: IconTerminal },
  { id: "ai",       label: "Ask AI",   Icon: IconSparkle  },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="shrink-0 flex border-b border-zinc-800/60 bg-zinc-950 px-3 py-2 gap-1">
      {TABS.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={[
              "flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors",
              "focus:outline-none",
              isActive
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50",
            ].join(" ")}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AppClient() {
  const [result,           setResult]           = useState<LoadFileResult | null>(null);
  const [activeTab,        setActiveTab]        = useState<Tab>("overview");
  const [additionalTables, setAdditionalTables] = useState<AdditionalTable[]>([]);

  useEffect(() => {
    return () => getDuckDBClient().terminate();
  }, []);

  const handleAddFile = useCallback(async (file: File) => {
    const added = await getDuckDBClient().loadAdditionalFile(file);
    setAdditionalTables((prev) => {
      // Replace if a table with the same name was already loaded
      const rest = prev.filter((t) => t.tableName !== added.tableName);
      return [...rest, added];
    });
  }, []);

  const handleDropTable = useCallback(async (tableName: string) => {
    await getDuckDBClient().dropTable(tableName);
    setAdditionalTables((prev) => prev.filter((t) => t.tableName !== tableName));
  }, []);

  if (!result) {
    return (
      <UploadScreen
        onSuccess={(r) => {
          setResult(r);
          setAdditionalTables([]);
          setActiveTab("overview");
        }}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <Topbar
        result={result}
        additionalTables={additionalTables}
        onAddFile={handleAddFile}
        onDropTable={handleDropTable}
        onReset={() => {
          getDuckDBClient().terminate();
          setResult(null);
          setAdditionalTables([]);
        }}
      />
      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === "sql" ? (
        /* ── SQL tab: full-height, no outer scroll ── */
        <main className="flex-1 min-h-0 overflow-hidden px-6 py-4">
          <SQLEditor
            schema={result.schema}
            tableName={result.tableName}
            additionalTables={additionalTables}
          />
        </main>
      ) : (
        /* ── All other tabs: normal scrollable container ── */
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8">

            {/* ── Overview ── */}
            {activeTab === "overview" && (
              <DashboardVisuals
                schema={result.schema}
                data={result.chartRows}
                totalRows={result.totalRows}
                view="kpis"
              />
            )}

            {/* ── Charts ── */}
            {activeTab === "charts" && (
              <DashboardVisuals
                schema={result.schema}
                data={result.chartRows}
                totalRows={result.totalRows}
                view="charts"
              />
            )}

            {/* ── Data ── */}
            {activeTab === "data" && (
              <DataPreviewTable result={result} />
            )}

            {/* ── Ask AI ── */}
            {activeTab === "ai" && (
              <AIAssistant
                schema={result.schema}
                totalRows={result.totalRows}
                fileName={result.fileName}
                tableName={result.tableName}
                onSwitchToSQL={() => setActiveTab("sql")}
              />
            )}

          </div>
        </main>
      )}
    </div>
  );
}
