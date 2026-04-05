// Pure-JS semantic classifier — no model download, no network requests, no WASM.
// Works offline, unaffected by COEP headers, runs in <1 ms for any schema size.
//
// Coverage: sensor/IoT, agriculture, finance, CRM, e-commerce, analytics.
// Confidence scores mirror what a zero-shot NLI model would return so the rest
// of the codebase can treat this as a drop-in replacement.

import type { SchemaColumn } from "./duckdb/db-client";

// ─── Public types (kept identical to the Transformers.js version) ─────────────

export type SemanticType =
  | "measurement"  // sensor / rate readings  → avg, min, max
  | "cumulative"   // additive financial/count → sum
  | "category"     // group labels             → bar, pie
  | "timestamp"    // date / time axis         → line chart x-axis
  | "identifier"   // row keys / IDs           → skip
  | "unknown";

export type ColumnSemantic = {
  column_name: string;
  semantic:    SemanticType;
  confidence:  number;
};

export type ClassifierProgress =
  | { stage: "downloading"; file: string; pct: number }  // unused; kept for compat
  | { stage: "classifying"; done: number; total: number }
  | { stage: "done" };

// ─── Pattern rules (ordered by confidence) ───────────────────────────────────

type Rule = { pattern: RegExp; semantic: SemanticType; confidence: number };

const RULES: Rule[] = [
  // ── Identifiers ─────────────────────────────────────────────────────────────
  { pattern: /^id$/i,                                                                 semantic: "identifier",  confidence: 0.99 },
  { pattern: /_id$/i,                                                                 semantic: "identifier",  confidence: 0.97 },
  { pattern: /^id[_\-]/i,                                                             semantic: "identifier",  confidence: 0.95 },
  { pattern: /\b(uuid|guid|hash|token|pk|fk|serial|rowid|record_?id)\b/i,            semantic: "identifier",  confidence: 0.95 },

  // ── Timestamps ──────────────────────────────────────────────────────────────
  { pattern: /\b(timestamp|datetime)\b/i,                                             semantic: "timestamp",   confidence: 0.99 },
  { pattern: /_(at|on|ts|dt|date|time)$/i,                                            semantic: "timestamp",   confidence: 0.95 },
  { pattern: /^(date|time|created|updated|modified|recorded|reported|measured)$/i,    semantic: "timestamp",   confidence: 0.95 },
  { pattern: /\b(year|month|day|week|hour|minute|second|quarter|period|epoch)\b/i,    semantic: "timestamp",   confidence: 0.87 },

  // ── Physical / environmental / sensor measurements ───────────────────────────
  { pattern: /\b(temp|temperature)\b/i,                                               semantic: "measurement", confidence: 0.99 },
  { pattern: /\b(humidity|moisture|dew_?point)\b/i,                                   semantic: "measurement", confidence: 0.99 },
  { pattern: /\b(pressure|barometric|atmospheric)\b/i,                                semantic: "measurement", confidence: 0.98 },
  { pattern: /\b(co2|o2|no2|so2|pm2?_?5|pm10|aqi|voc|ozone|gas)\b/i,                 semantic: "measurement", confidence: 0.98 },
  { pattern: /\b(voltage|current|watt|power|energy|kwh|ampere|ohm|wattage)\b/i,       semantic: "measurement", confidence: 0.98 },
  { pattern: /\b(speed|velocity|rpm|acceleration|wind|gust|flow_?rate)\b/i,           semantic: "measurement", confidence: 0.97 },
  { pattern: /\b(altitude|elevation|depth|height|distance|range)\b/i,                 semantic: "measurement", confidence: 0.96 },
  { pattern: /\b(lat(itude)?|lon(gitude)?|lng|coord)\b/i,                             semantic: "measurement", confidence: 0.96 },
  { pattern: /\b(ph|ec|tds|salinity|conductivity|turbidity)\b/i,                      semantic: "measurement", confidence: 0.96 },
  { pattern: /\b(nitrogen|phospho|potassium|calcium|magnesium|iron|zinc|soil|air)\b/i, semantic: "measurement", confidence: 0.96 },
  { pattern: /\b(light|lux|uv|radiation|irradiance|solar|par)\b/i,                    semantic: "measurement", confidence: 0.95 },
  { pattern: /\b(weight|mass|volume|density|viscosity|torque|force)\b/i,              semantic: "measurement", confidence: 0.94 },
  { pattern: /\b(concentration|ppm|ppb|mg_?l|ug_?m3)\b/i,                            semantic: "measurement", confidence: 0.96 },
  { pattern: /\b(ratio|rate|pct|percent(age)?)\b/i,                                   semantic: "measurement", confidence: 0.90 },
  { pattern: /\b(score|rating|index|coefficient|factor|metric)\b/i,                   semantic: "measurement", confidence: 0.87 },
  { pattern: /\b(heart_?rate|bpm|pulse|glucose|cholesterol|blood|spo2)\b/i,           semantic: "measurement", confidence: 0.97 },
  { pattern: /\b(rainfall|precipitation|snow|frost|dewpoint)\b/i,                     semantic: "measurement", confidence: 0.97 },
  { pattern: /\b(load|cpu|memory|disk|bandwidth|throughput|latency)\b/i,              semantic: "measurement", confidence: 0.93 },

  // ── Cumulative / financial ───────────────────────────────────────────────────
  { pattern: /\b(revenue|sales|profit|margin|income|earnings|turnover)\b/i,           semantic: "cumulative",  confidence: 0.98 },
  { pattern: /\b(cost|price|amount|fee|charge|expense|spend|budget)\b/i,              semantic: "cumulative",  confidence: 0.97 },
  { pattern: /\b(balance|credit|debit|payment|invoice|receipt|refund)\b/i,            semantic: "cumulative",  confidence: 0.97 },
  { pattern: /\b(total|sum|subtotal|grand_?total)\b/i,                                semantic: "cumulative",  confidence: 0.96 },
  { pattern: /\b(count|qty|quantity|units|items|orders|transactions|purchases)\b/i,   semantic: "cumulative",  confidence: 0.95 },
  { pattern: /\b(clicks|views|impressions|sessions|visits|pageviews)\b/i,             semantic: "cumulative",  confidence: 0.95 },
  { pattern: /\b(downloads|installs|sign_?ups|registrations|conversions)\b/i,         semantic: "cumulative",  confidence: 0.94 },

  // ── Categorical / label ──────────────────────────────────────────────────────
  { pattern: /\b(name|label|title|tag|description|desc|note|remark)\b/i,              semantic: "category",    confidence: 0.93 },
  { pattern: /\b(type|kind|class|category|cat|genre|subtype|sub_?category)\b/i,       semantic: "category",    confidence: 0.92 },
  { pattern: /\b(status|state|stage|phase|flag|mode|active|enabled)\b/i,              semantic: "category",    confidence: 0.92 },
  { pattern: /\b(region|country|city|state|province|zone|area|location|place)\b/i,    semantic: "category",    confidence: 0.92 },
  { pattern: /\b(brand|product|model|sku|variant|edition|version|release)\b/i,        semantic: "category",    confidence: 0.90 },
  { pattern: /\b(department|team|group|division|segment|sector|unit|org)\b/i,         semantic: "category",    confidence: 0.90 },
  { pattern: /\b(channel|platform|source|medium|campaign|device|os)\b/i,              semantic: "category",    confidence: 0.89 },
  { pattern: /\b(gender|age_?group|tier|plan|level|rank|grade)\b/i,                   semantic: "category",    confidence: 0.88 },
];

// ─── DuckDB type → semantic override (highest priority) ──────────────────────

const DATETIME_DB_TYPES = new Set([
  "DATE", "TIMESTAMP", "TIMESTAMPTZ",
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMP_S", "TIMESTAMP_MS", "TIMESTAMP_NS",
  "TIME",
]);

function typeOverride(colType: string): SemanticType | null {
  const norm = colType.toUpperCase().replace(/\s*\(.*\)$/, "").trim();
  if (DATETIME_DB_TYPES.has(norm)) return "timestamp";
  return null;
}

// ─── Core single-column classifier ───────────────────────────────────────────

function classifyOne(col: SchemaColumn): ColumnSemantic {
  // 1. DuckDB type wins unconditionally — a TIMESTAMP is always a timestamp
  const override = typeOverride(col.column_type);
  if (override) {
    return { column_name: col.column_name, semantic: override, confidence: 1.0 };
  }

  // 2. Normalise name — split camelCase, lowercase, keep word boundaries
  const tokens = col.column_name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

  // 3. Score all matching rules, take the highest-confidence match
  let best: { semantic: SemanticType; confidence: number } | null = null;
  for (const rule of RULES) {
    if (rule.pattern.test(tokens)) {
      if (!best || rule.confidence > best.confidence) {
        best = { semantic: rule.semantic, confidence: rule.confidence };
      }
    }
  }
  if (best) return { column_name: col.column_name, ...best };

  // 4. Type-based fallback for unmatched names
  const normType = col.column_type.toUpperCase().replace(/\s*\(.*\)$/, "").trim();
  if (["VARCHAR", "TEXT", "CHAR", "STRING"].includes(normType)) {
    return { column_name: col.column_name, semantic: "category",    confidence: 0.55 };
  }
  if (["DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMERIC",
       "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "INT", "HUGEINT"].includes(normType)) {
    return { column_name: col.column_name, semantic: "measurement", confidence: 0.50 };
  }

  return { column_name: col.column_name, semantic: "unknown", confidence: 0 };
}

// ─── Public API (identical signature to the Transformers.js version) ──────────

export async function classifyColumns(
  schema:     SchemaColumn[],
  onProgress: (p: ClassifierProgress) => void,
): Promise<ColumnSemantic[]> {
  const results: ColumnSemantic[] = [];

  for (let i = 0; i < schema.length; i++) {
    results.push(classifyOne(schema[i]));
    onProgress({ stage: "classifying", done: i + 1, total: schema.length });
  }

  onProgress({ stage: "done" });
  return results;
}
