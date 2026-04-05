import type { SchemaColumn } from "@/app/lib/duckdb/db-client";
import type { ColumnSemantic, SemanticType } from "@/app/lib/columnClassifier";

// ─── Column-type classifiers (heuristic fallback) ─────────────────────────────

const NUMERIC_TYPES = new Set([
  "INTEGER", "INT", "INT4", "INT2", "INT1",
  "BIGINT", "INT8", "HUGEINT", "UHUGEINT",
  "SMALLINT", "TINYINT",
  "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT",
  "DOUBLE", "FLOAT", "FLOAT4", "FLOAT8",
  "DECIMAL", "NUMERIC", "REAL",
]);

const DATETIME_TYPES = new Set([
  "DATE", "TIMESTAMP", "TIMESTAMPTZ",
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMP_S", "TIMESTAMP_MS", "TIMESTAMP_NS",
  "TIME",
]);

const STRING_TYPES = new Set([
  "VARCHAR", "TEXT", "CHAR", "STRING", "BLOB", "CHARACTER VARYING",
]);

function normalizeType(raw: string): string {
  return raw.toUpperCase().replace(/\s*\(.*\)$/, "").trim();
}

export function isNumericType(t: string): boolean {
  return NUMERIC_TYPES.has(normalizeType(t));
}

export function isDatetimeType(t: string): boolean {
  return DATETIME_TYPES.has(normalizeType(t));
}

export function isStringType(t: string): boolean {
  return STRING_TYPES.has(normalizeType(t));
}

// ─── Recommendation shapes ────────────────────────────────────────────────────

export type KpiRecommendation = {
  type:     "kpi";
  label:    string;
  value:    string | number;
  subLabel?: string;
  accent:   "violet" | "sky" | "emerald" | "amber" | "rose";
};

export type LineChartRecommendation = {
  type:   "line";
  title:  string;
  xKey:   string;
  yKeys:  string[];
};

export type BarChartRecommendation = {
  type:  "bar";
  title: string;
  xKey:  string;
  yKeys: string[];
};

export type PieChartRecommendation = {
  type:     "pie";
  title:    string;
  nameKey:  string;
  valueKey: string;
};

export type ChartRecommendation =
  | KpiRecommendation
  | LineChartRecommendation
  | BarChartRecommendation
  | PieChartRecommendation;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMetric(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000)     return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)         return `${(v / 1_000).toFixed(1)}K`;
  return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2);
}

const KPI_ACCENTS: KpiRecommendation["accent"][] = [
  "violet", "sky", "emerald", "amber", "rose",
];

// ─── Semantic column bucketing ────────────────────────────────────────────────

/**
 * When AI semantics are available, bucket columns by their inferred meaning.
 * When not (first render, or model error), fall back to DuckDB data-type rules.
 *
 * The AI path also catches VARCHAR columns that were not inferred as TIMESTAMP
 * by DuckDB (e.g. dates in non-ISO formats) — they show up as SemanticType
 * "timestamp" even though column_type is VARCHAR.
 */
function bucketColumns(
  schema:    SchemaColumn[],
  semMap:    Map<string, SemanticType> | null,
): {
  numericCols:   SchemaColumn[];
  dateCols:      SchemaColumn[];
  categoryCols:  SchemaColumn[];
  skipCols:      Set<string>;
} {
  if (!semMap) {
    // Pure heuristic path
    return {
      numericCols:  schema.filter(c => isNumericType(c.column_type)),
      dateCols:     schema.filter(c => isDatetimeType(c.column_type)),
      categoryCols: schema.filter(c => isStringType(c.column_type)),
      skipCols:     new Set(),
    };
  }

  // AI-enhanced path
  const numericCols:  SchemaColumn[] = [];
  const dateCols:     SchemaColumn[] = [];
  const categoryCols: SchemaColumn[] = [];
  const skipCols      = new Set<string>();

  for (const col of schema) {
    const sem = semMap.get(col.column_name) ?? "unknown";

    switch (sem) {
      case "measurement":
      case "cumulative":
        numericCols.push(col);
        break;
      case "timestamp":
        dateCols.push(col);
        break;
      case "category":
        categoryCols.push(col);
        break;
      case "identifier":
        skipCols.add(col.column_name);
        break;
      default:
        // "unknown" — fall back to column data type
        if (isNumericType(col.column_type))       numericCols.push(col);
        else if (isDatetimeType(col.column_type)) dateCols.push(col);
        else if (isStringType(col.column_type))   categoryCols.push(col);
    }
  }

  return { numericCols, dateCols, categoryCols, skipCols };
}

// ─── Main recommender ─────────────────────────────────────────────────────────

/**
 * Pure function — never mutates its inputs.
 *
 * Pass `semantics` once the AI classifier resolves to get enhanced output:
 *  • measurement columns → Avg / Min / Max KPI cards (not Sum)
 *  • cumulative columns  → Sum KPI card
 *  • timestamp VARCHAR   → treated as date axis (fixes un-inferred timestamps)
 *  • identifier columns  → skipped entirely
 *
 * Without `semantics` the function runs the heuristic rules from Phase 2
 * so charts are always shown immediately on load.
 */
export function getChartRecommendations(
  schema:    SchemaColumn[],
  data:      Record<string, unknown>[],
  totalRows: number,
  semantics?: ColumnSemantic[],
): ChartRecommendation[] {
  const recommendations: ChartRecommendation[] = [];

  const semMap: Map<string, SemanticType> | null = semantics
    ? new Map(semantics.map(s => [s.column_name, s.semantic]))
    : null;

  const { numericCols, dateCols, categoryCols, skipCols } =
    bucketColumns(schema, semMap);

  const isSampled = data.length < totalRows;
  const est       = isSampled ? "~" : "";

  // ── Rule 3: KPI cards ──────────────────────────────────────────────────────
  recommendations.push({
    type:     "kpi",
    label:    "Total Rows",
    value:    totalRows.toLocaleString(),
    subLabel: `${schema.length} column${schema.length !== 1 ? "s" : ""}`,
    accent:   "violet",
  });

  numericCols.slice(0, 3).forEach((col, i) => {
    if (skipCols.has(col.column_name)) return;

    const values = data
      .map(row => Number(row[col.column_name]))
      .filter(v => Number.isFinite(v));
    if (values.length === 0) return;

    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const accent = KPI_ACCENTS[(i + 1) % KPI_ACCENTS.length];
    const isMeasurement = semMap?.get(col.column_name) === "measurement";

    if (isMeasurement) {
      // Sensor/rate reading — sum is meaningless; show avg + range
      recommendations.push({
        type:     "kpi",
        label:    `Avg · ${col.column_name}`,
        value:    `${est}${fmtMetric(avg)}`,
        subLabel: `min ${fmtMetric(min)} · max ${fmtMetric(max)}`,
        accent,
      });
    } else {
      // Cumulative total or unknown — sum makes sense
      recommendations.push({
        type:     "kpi",
        label:    `Sum · ${col.column_name}`,
        value:    `${est}${fmtMetric(sum)}`,
        subLabel: `avg ${est}${fmtMetric(avg)}`,
        accent,
      });
    }
  });

  // ── Rule 1: One time-series line chart per numeric column ──────────────────
  if (dateCols.length > 0 && numericCols.length > 0) {
    const xKey        = dateCols[0].column_name;
    const eligibleNum = numericCols
      .filter(c => !skipCols.has(c.column_name))
      .slice(0, 8); // cap at 8 charts to avoid overwhelming the grid

    for (const col of eligibleNum) {
      recommendations.push({
        type:  "line",
        title: `${col.column_name} over time`,
        xKey,
        yKeys: [col.column_name],
      });
    }
  }

  // ── Rule 2: One bar (+ optional pie) per numeric × category combination ────
  for (const strCol of categoryCols.slice(0, 2)) {
    const cardinality = new Set(data.map(row => row[strCol.column_name])).size;
    // AI-classified category columns get a wider cardinality budget
    const limit = semMap?.get(strCol.column_name) === "category" ? 40 : 30;
    if (cardinality > limit || cardinality < 2) continue;

    const eligibleNum = numericCols
      .filter(c => !skipCols.has(c.column_name))
      .slice(0, 4); // cap bars per category column

    for (const numCol of eligibleNum) {
      recommendations.push({
        type:  "bar",
        title: `${numCol.column_name} by ${strCol.column_name}`,
        xKey:  strCol.column_name,
        yKeys: [numCol.column_name],
      });
    }

    // Pie only for the primary numeric column and only when cardinality is low
    const primaryNum = numericCols.find(c => !skipCols.has(c.column_name));
    if (primaryNum && cardinality <= 10) {
      recommendations.push({
        type:     "pie",
        title:    `${primaryNum.column_name} share by ${strCol.column_name}`,
        nameKey:  strCol.column_name,
        valueKey: primaryNum.column_name,
      });
    }
  }

  return recommendations;
}
