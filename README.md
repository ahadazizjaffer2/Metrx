# Metrx — Private Data Intelligence

> Transform massive datasets into interactive dashboards — entirely in your browser.

Metrx is a fully client-side Next.js application that lets you upload a CSV file and instantly get:
- **KPI cards** summarising your key metrics
- **Auto-generated charts** (line, bar, pie) derived from your data's structure
- **A full data-preview table** with column schema
- **An on-device AI assistant** (Phi-3.5-mini via WebGPU) that answers plain-English questions about your data using DuckDB SQL under the hood

**No server, no API key, no data upload — everything runs privately on your device.**

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [File Tree](#file-tree)
3. [Getting Started](#getting-started)
4. [Project Structure](#project-structure)
   - [Pages & Routing](#pages--routing)
   - [Components](#components)
   - [Lib / Utils](#lib--utils)
5. [Environment Variables](#environment-variables)
6. [Architecture Notes](#architecture-notes)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, TypeScript) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| In-browser SQL | [@duckdb/duckdb-wasm](https://github.com/duckdb/duckdb-wasm) |
| Charts | [Recharts](https://recharts.org) |
| On-device LLM | [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) (Phi-3.5-mini-instruct, WebGPU) |

---

## File Tree

```
Metrx/
├── public/
│   ├── Metrx icon.png          # Small icon used in the top-bar when data is loaded
│   └── Metrx.png               # Full logo shown on the upload/landing screen
│
├── src/
│   └── app/
│       ├── layout.tsx           # Root HTML shell (Inter font, dark background)
│       ├── page.tsx             # Root route — redirects to /dashboard
│       ├── globals.css          # Tailwind CSS base import + CSS custom properties
│       ├── favicon.ico
│       │
│       ├── dashboard/
│       │   └── page.tsx         # Dashboard route — renders <AppClientWrapper>
│       │
│       ├── components/
│       │   ├── AppClientWrapper.tsx   # Thin dynamic-import wrapper (disables SSR)
│       │   ├── AppClient.tsx          # Main shell: upload screen → tabbed dashboard
│       │   ├── DashboardVisuals.tsx   # KPI cards + Recharts charts
│       │   ├── DataPreviewTable.tsx   # Schema pills + scrollable data table
│       │   └── AIAssistant.tsx        # WebLLM chat UI with two-pass SQL→NL pipeline
│       │
│       └── lib/
│           ├── chartUtils.ts          # Chart recommendation engine + type helpers
│           ├── columnClassifier.ts    # Pure-JS semantic column classifier
│           ├── webllm.ts              # WebLLM singleton + SQL-gen / answer streaming
│           └── duckdb/
│               ├── db-client.ts       # DuckDB client (spawns worker, typed API)
│               └── worker.ts          # DuckDB Web Worker (CSV ingestion + queries)
│
├── next.config.ts               # COOP/COEP headers, Turbopack, WASM webpack config
├── tsconfig.json
├── package.json
├── postcss.config.mjs
└── eslint.config.mjs
```

> **Note:** There are no API routes (`/app/api`), no Prisma schema, no models folder, no middleware, and no environment variables — the entire application runs client-side.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A Chromium-based browser (Chrome 113+ or Edge 113+) with **WebGPU** enabled for the AI assistant tab (all other features work in any modern browser)

### Install & run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for production

```bash
npm run build
npm start
```

### Lint

```bash
npm run lint
```

---

## Project Structure

### Pages & Routing

| File | Route | Purpose |
|---|---|---|
| `src/app/page.tsx` | `/` | Redirects to `/dashboard` |
| `src/app/layout.tsx` | (root layout) | Sets `<html lang="en" class="dark">`, applies Inter font, dark zinc background |
| `src/app/dashboard/page.tsx` | `/dashboard` | Renders `<AppClientWrapper>` (SSR-disabled entry point) |

### Components

#### `AppClientWrapper.tsx`

A minimal dynamic-import wrapper around `AppClient`. It disables SSR (`ssr: false`) for the entire dashboard shell so that browser-only APIs (DuckDB WASM, WebWorker, WebGPU) are never invoked on the server.

#### `AppClient.tsx`

The main application shell. Manages two top-level states:

1. **Upload screen** (`UploadScreen`) — drag-and-drop / click-to-browse CSV uploader. Validates `.csv` extension, calls `getDuckDBClient().loadFile(file)`, shows loading and error states.
2. **Tabbed dashboard** — once a file is loaded, renders a `Topbar` (file badge + "Load new file" button) and a `TabBar` with four tabs:
   - **Overview** — KPI cards via `<DashboardVisuals view="kpis">`
   - **Charts** — auto-generated charts via `<DashboardVisuals view="charts">`
   - **Data** — schema + preview table via `<DataPreviewTable>`
   - **Ask AI** — conversational AI interface via `<AIAssistant>`

#### `DashboardVisuals.tsx`

Renders KPI cards and/or Recharts charts (line, bar, pie) based on recommendations from `getChartRecommendations()`. On mount it asynchronously runs the column classifier to upgrade heuristic recommendations with semantic ones (e.g. treating a VARCHAR `date` column as a time axis).

#### `DataPreviewTable.tsx`

Shows three stat badges (rows, columns, load time), typed schema pills (colour-coded by DuckDB type), and a scrollable preview of the first 5 rows.

#### `AIAssistant.tsx`

Full chat UI powered by WebLLM running Phi-3.5-mini entirely in the browser:

1. **Pass 1** — Silently generates a DuckDB SQL query from the user's question.
2. **Pass 1b** (optional) — If the SQL fails, asks the model to self-repair it.
3. **Pass 2** — Streams a plain-English answer using the query result as context.

Also generates a 3-bullet dataset snapshot ("insights") automatically when the engine first loads.

### Lib / Utils

#### `src/app/lib/chartUtils.ts`

- Exports `isNumericType`, `isDatetimeType`, `isStringType` — thin wrappers over DuckDB type name sets.
- Exports `getChartRecommendations(schema, data, totalRows, semantics?)` — pure function that returns typed `ChartRecommendation[]` (KPI cards, line/bar/pie charts). Works in two modes: heuristic (instant, on first render) and AI-enhanced (once `classifyColumns` resolves).

#### `src/app/lib/columnClassifier.ts`

A pure-JS, zero-dependency semantic classifier. Classifies each column into one of: `measurement | cumulative | category | timestamp | identifier | unknown`. Uses a priority-ordered rule table of regular expressions covering sensor/IoT, agriculture, finance, CRM, e-commerce, and analytics domains. No model download required — runs in < 1 ms.

#### `src/app/lib/webllm.ts`

Singleton WebLLM engine manager:
- `loadEngine()` — lazy-loads Phi-3.5-mini-instruct (2.4 GB, cached in browser after first download).
- `generateSQL(question, schema, totalRows, fileName)` — Pass 1 SQL generator.
- `fixSQL(brokenSQL, error, schema, totalRows, fileName)` — Pass 1b self-repair.
- `streamAnswer(question, queryRows, schema, totalRows, fileName)` — Pass 2 streaming NL answer (async generator).
- `streamInsights(schema, totalRows, fileName)` — streaming 3-bullet dataset summary.
- Progress subscription utilities (`subscribeToProgress`, `getLoadProgress`).

#### `src/app/lib/duckdb/db-client.ts`

Typed client for the DuckDB Web Worker. Exposes:
- `getDuckDBClient()` — returns the singleton `DuckDBClient` instance.
- `loadFile(file: File): Promise<LoadFileResult>` — transfers the file buffer to the worker (zero-copy via `Transferable`), returns rows, chart rows, schema, total count, and timing.
- `query(sql: string): Promise<Record<string, unknown>[]>` — runs arbitrary SQL against the ingested table.
- `terminate()` — tears down the worker.

#### `src/app/lib/duckdb/worker.ts`

The DuckDB Web Worker. Handles two message types:
- `LOAD_FILE` — registers the file buffer, creates `_metrx_ingested` via `read_csv_auto`, returns a 5-row preview, 500-row chart sample, total count, and `DESCRIBE` schema.
- `QUERY` — executes ad-hoc SQL and returns the result rows.

All Arrow `BigInt` values are converted to `Number` before posting back.

---

## Environment Variables

This project has **no environment variables**. The entire application runs client-side; there is no backend server, database connection string, or API key required.

See [`.env.example`](.env.example) for reference.

---

## Architecture Notes

### Cross-Origin Isolation

DuckDB's multi-threaded WASM bundle requires `SharedArrayBuffer`, which in turn requires `crossOriginIsolated = true`. The app sets:

```
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy:   same-origin
```

`credentialless` (rather than `require-corp`) is used so that WebLLM can download model shards from the Hugging Face CDN, which does not set `CORP` headers.

### Data Privacy

- CSV data is parsed entirely inside a DuckDB WASM instance running in a Web Worker — it never leaves the browser tab.
- The LLM (Phi-3.5-mini) is downloaded once from the Hugging Face CDN and cached in the browser's Cache API. After the first download all inference runs locally with no network calls.
- Only column **names** and **types** (never actual row values) are sent to the LLM to generate SQL; query results are sent only in the Pass 2 answer step, and only as a compact 5-row sample.
