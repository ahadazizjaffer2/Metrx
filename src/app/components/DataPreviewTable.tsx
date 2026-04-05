"use client";

import type { LoadFileResult } from "@/app/lib/duckdb/db-client";

interface Props {
  result: LoadFileResult;
}

const TYPE_COLORS: Record<string, string> = {
  VARCHAR:   "bg-violet-500/15 text-violet-300 border-violet-500/20",
  INTEGER:   "bg-sky-500/15 text-sky-300 border-sky-500/20",
  BIGINT:    "bg-sky-500/15 text-sky-300 border-sky-500/20",
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

export default function DataPreviewTable({ result }: Props) {
  const { rows, schema, totalRows, durationMs } = result;
  if (!rows.length || !schema.length) return null;

  const columns = schema.map((s) => s.column_name);

  return (
    <div className="space-y-5">

      {/* Stat bar */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: "Rows",      value: totalRows.toLocaleString() },
          { label: "Columns",   value: String(schema.length) },
          { label: "Load time", value: `${durationMs} ms` },
        ].map(({ label, value }) => (
          <div key={label}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                       bg-zinc-900 border border-zinc-800 text-xs">
            <span className="text-zinc-500">{label}</span>
            <span className="text-zinc-200 font-medium font-mono">{value}</span>
          </div>
        ))}
      </div>

      {/* Schema pills */}
      <div>
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">
          Columns
        </p>
        <div className="flex flex-wrap gap-2">
          {schema.map((col) => (
            <div key={col.column_name}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full
                          border text-[11px] ${typeColor(col.column_type)}`}>
              <span className="font-medium">{col.column_name}</span>
              <span className="opacity-60">{col.column_type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Preview table */}
      <div>
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">
          Data preview
        </p>
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80">
                <th className="px-4 py-2.5 text-left text-zinc-600 font-normal w-10">#</th>
                {columns.map((col) => (
                  <th key={col}
                    className="px-4 py-2.5 text-left text-zinc-400 font-medium
                               uppercase tracking-wider whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {rows.map((row, i) => (
                <tr key={i} className="bg-zinc-950 hover:bg-zinc-900/40 transition-colors">
                  <td className="px-4 py-2.5 text-zinc-700 font-mono">{i + 1}</td>
                  {columns.map((col) => (
                    <td key={col}
                      className="px-4 py-2.5 text-zinc-300 font-mono whitespace-nowrap
                                 max-w-[260px] truncate"
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
        </div>
        {totalRows > 5 && (
          <p className="text-[11px] text-zinc-700 mt-2 text-right">
            Showing 5 of {totalRows.toLocaleString()} rows
          </p>
        )}
      </div>
    </div>
  );
}