// src/app/components/DashboardVisuals.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
  ResponsiveContainer,
  type PieLabelRenderProps,
} from "recharts";
import {
  getChartRecommendations,
  type ChartRecommendation,
  type KpiRecommendation,
  type LineChartRecommendation,
  type BarChartRecommendation,
  type PieChartRecommendation,
} from "@/app/lib/chartUtils";
import type { SchemaColumn } from "@/app/lib/duckdb/db-client";
import type { ColumnSemantic } from "@/app/lib/columnClassifier";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  schema:    SchemaColumn[];
  data:      Record<string, unknown>[];
  totalRows: number;
  view:      "kpis" | "charts";
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const PALETTE = [
  "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899",
  "#a78bfa", "#34d399",
];

const ACCENT_MAP = {
  violet:  { bg: "bg-violet-500/10",  border: "border-violet-500/20",  text: "text-violet-300",  dot: "bg-violet-500"  },
  sky:     { bg: "bg-sky-500/10",     border: "border-sky-500/20",     text: "text-sky-300",     dot: "bg-sky-500"     },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-300", dot: "bg-emerald-500" },
  amber:   { bg: "bg-amber-500/10",   border: "border-amber-500/20",   text: "text-amber-300",   dot: "bg-amber-500"   },
  rose:    { bg: "bg-rose-500/10",    border: "border-rose-500/20",    text: "text-rose-300",    dot: "bg-rose-500"    },
} as const;

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "#18181b",
  border:          "1px solid #3f3f46",
  borderRadius:    "10px",
  color:           "#e4e4e7",
  fontSize:        "12px",
  boxShadow:       "0 4px 24px rgba(0,0,0,0.5)",
};

const AXIS_TICK = { fill: "#52525b", fontSize: 11 };

// ─── AI status types ──────────────────────────────────────────────────────────

type AIStatus = "idle" | "ready" | "error";

// ─── Data transforms ──────────────────────────────────────────────────────────

function prepareLineData(
  data: Record<string, unknown>[],
  rec:  LineChartRecommendation,
): Record<string, unknown>[] {
  return data
    .map(row => {
      const raw = String(row[rec.xKey] ?? "");
      // Normalise to YYYY-MM-DD for consistent sorting & display
      const _x = raw.length >= 10 ? raw.slice(0, 10) : raw;
      const entry: Record<string, unknown> = { _x };
      for (const y of rec.yKeys) entry[y] = Number(row[y]) || 0;
      return entry;
    })
    .sort((a, b) => String(a._x).localeCompare(String(b._x)));
}

function prepareBarData(
  data: Record<string, unknown>[],
  rec:  BarChartRecommendation,
): Record<string, unknown>[] {
  const agg = new Map<string, Record<string, number>>();
  for (const row of data) {
    const key = String(row[rec.xKey] ?? "(blank)");
    if (!agg.has(key)) agg.set(key, Object.fromEntries(rec.yKeys.map(y => [y, 0])));
    for (const y of rec.yKeys) agg.get(key)![y] += Number(row[y]) || 0;
  }
  const primary = rec.yKeys[0];
  return Array.from(agg.entries())
    .map(([name, vals]): Record<string, unknown> => ({ name, ...vals }))
    .sort((a, b) => (Number(b[primary]) || 0) - (Number(a[primary]) || 0))
    .slice(0, 20);
}

function preparePieData(
  data: Record<string, unknown>[],
  rec:  PieChartRecommendation,
): { name: string; value: number }[] {
  const agg = new Map<string, number>();
  for (const row of data) {
    const key = String(row[rec.nameKey] ?? "(blank)");
    agg.set(key, (agg.get(key) ?? 0) + (Number(row[rec.valueKey]) || 0));
  }
  return Array.from(agg.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ rec }: { rec: KpiRecommendation }) {
  const s = ACCENT_MAP[rec.accent];
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-1.5 ${s.bg} ${s.border}`}>
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest truncate">
          {rec.label}
        </span>
      </div>
      <p className={`text-2xl font-bold tracking-tight ${s.text}`}>{rec.value}</p>
      {rec.subLabel && <p className="text-[11px] text-zinc-600">{rec.subLabel}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <p className="text-sm font-medium text-zinc-300 mb-5 truncate">{title}</p>
      {children}
    </div>
  );
}

function CustomPieLabel(props: PieLabelRenderProps) {
  const {
    cx = 0, cy = 0, midAngle = 0,
    innerRadius = 0, outerRadius = 0, percent = 0,
  } = props;
  if ((percent as number) < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * 0.5;
  const x = Number(cx) + r * Math.cos(-Number(midAngle) * RADIAN);
  const y = Number(cy) + r * Math.sin(-Number(midAngle) * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={600}>
      {`${((percent as number) * 100).toFixed(0)}%`}
    </text>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardVisuals({ schema, data, totalRows, view }: Props) {
  const [aiStatus,  setAIStatus]  = useState<AIStatus>("idle");
  const [semantics, setSemantics] = useState<ColumnSemantic[]>([]);
  const schemaRef = useRef(schema);

  useEffect(() => {
    schemaRef.current = schema;
    setSemantics([]);

    import("@/app/lib/columnClassifier")
      .then(({ classifyColumns }) => classifyColumns(schema, () => {}))
      .then((results) => {
        if (schemaRef.current !== schema) return;
        setSemantics(results);
        setAIStatus("ready");
      })
      .catch((err) => {
        if (schemaRef.current !== schema) return;
        console.error("[DashboardVisuals] Classifier failed:", err);
        setAIStatus("error");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  // Recompute recommendations whenever semantics update.
  // On first render semantics is empty → heuristic path runs instantly.
  // After AI completes the recs are silently upgraded.
  const recs = useMemo(
    () => getChartRecommendations(
      schema, data, totalRows,
      semantics.length > 0 ? semantics : undefined,
    ),
    [schema, data, totalRows, semantics],
  );

  const kpis  = recs.filter((r): r is KpiRecommendation       => r.type === "kpi");
  const lines = recs.filter((r): r is LineChartRecommendation => r.type === "line");
  const bars  = recs.filter((r): r is BarChartRecommendation  => r.type === "bar");
  const pies  = recs.filter((r): r is PieChartRecommendation  => r.type === "pie");
  const hasCharts = lines.length + bars.length + pies.length > 0;

  return (
    <div className="space-y-6">

      {/* ── KPI view (Overview tab) ── */}
      {view === "kpis" && (
        kpis.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {kpis.map((kpi, i) => <KpiCard key={i} rec={kpi} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center">
            <p className="text-zinc-500 text-sm">No metrics found for this dataset.</p>
          </div>
        )
      )}

      {/* ── Charts view (Charts tab) ── */}
      {view === "charts" && (
        <>
          {data.length < totalRows && (
            <p className="text-[11px] text-zinc-600">
              Showing a sample of {data.length.toLocaleString()} / {totalRows.toLocaleString()} rows
            </p>
          )}

          {hasCharts ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {lines.map((rec, i) => {
                const chartData = prepareLineData(data, rec);
                if (chartData.length < 2) return null;
                return (
                  <ChartCard key={`line-${i}`} title={rec.title}>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis
                          dataKey="_x"
                          tick={AXIS_TICK}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={60} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "#3f3f46", strokeWidth: 1 }} />
                        <Legend wrapperStyle={{ fontSize: 11, color: "#71717a", paddingTop: 8 }} />
                        {rec.yKeys.map((yKey, j) => (
                          <Line
                            key={yKey}
                            type="monotone"
                            dataKey={yKey}
                            stroke={PALETTE[j % PALETTE.length]}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, strokeWidth: 0 }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                );
              })}

              {bars.map((rec, i) => {
                const chartData = prepareBarData(data, rec);
                if (chartData.length === 0) return null;
                const hasLongLabels = chartData.some(d => String(d.name).length > 8);
                return (
                  <ChartCard key={`bar-${i}`} title={rec.title}>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={chartData}
                        margin={{ top: 4, right: 12, left: -20, bottom: hasLongLabels ? 40 : 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ ...AXIS_TICK, dy: hasLongLabels ? 6 : 0 }}
                          axisLine={false}
                          tickLine={false}
                          angle={hasLongLabels ? -35 : 0}
                          textAnchor={hasLongLabels ? "end" : "middle"}
                          interval={0}
                        />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={60} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#27272a" }} />
                        {rec.yKeys.map((yKey, j) => (
                          <Bar
                            key={yKey}
                            dataKey={yKey}
                            fill={PALETTE[j % PALETTE.length]}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={48}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                );
              })}

              {pies.map((rec, i) => {
                const chartData = preparePieData(data, rec);
                if (chartData.length === 0) return null;
                return (
                  <ChartCard key={`pie-${i}`} title={rec.title}>
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={chartData}
                          cx="50%"
                          cy="45%"
                          innerRadius={55}
                          outerRadius={95}
                          dataKey="value"
                          nameKey="name"
                          paddingAngle={2}
                          labelLine={false}
                          label={CustomPieLabel}
                        >
                          {chartData.map((_, j) => (
                            <Cell key={j} fill={PALETTE[j % PALETTE.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Legend
                          iconType="circle"
                          iconSize={7}
                          wrapperStyle={{ fontSize: 11, color: "#71717a", paddingTop: 4 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartCard>
                );
              })}

            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center">
              <p className="text-zinc-500 text-sm">
                No charts could be generated for this dataset.
              </p>
              <p className="text-zinc-700 text-xs mt-1.5">
                Try a CSV with numeric columns and at least one date or categorical column.
              </p>
            </div>
          )}
        </>
      )}

    </div>
  );
}
