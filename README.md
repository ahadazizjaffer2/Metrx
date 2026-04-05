# Metrx — Private Data Intelligence

> **Transform massive datasets into interactive dashboards. Entirely in your browser.**

Metrx is a privacy-first data intelligence and visualization platform. Upload any CSV file and instantly get auto-generated charts, key metrics, and AI-powered natural language queries — with **zero data ever leaving your device**.

---

## Features

- **CSV Upload & Instant Analysis** — Drag and drop a CSV file; Metrx loads it into an in-browser SQL database in seconds.
- **Auto-Generated Charts** — A chart recommendation engine inspects your data's schema and automatically suggests and renders Line, Bar, and Pie charts.
- **KPI Cards** — Key numeric metrics are surfaced on an Overview dashboard.
- **Data Preview** — Browse schema details (column names, types) and a scrollable sample of raw rows.
- **AI Assistant** — Ask natural-language questions about your data. A 2.4 GB language model (Phi-3.5-mini) runs fully in-browser via WebGPU, generating and executing SQL on your behalf.
- **100% Private** — All processing (SQL queries, LLM inference) happens locally. No servers, no uploads, no API keys required.

---

## How It Works

```
CSV File → DuckDB WASM (Web Worker) → Schema & Sample Data
                                           │
                              ┌────────────┴────────────┐
                         Chart Engine              AI Assistant
                       (chartUtils.ts)            (webllm.ts)
                       columnClassifier.ts      Phi-3.5-mini LLM
                              │                       │
                         Recharts UI          SQL → DuckDB → Results
```

### Data Processing (DuckDB WASM)

When you upload a CSV, Metrx hands it to a **Web Worker** (`src/app/lib/duckdb/worker.ts`) that spins up [DuckDB WASM](https://duckdb.org/docs/api/wasm/overview.html) — a fully in-browser SQL engine. DuckDB parses the file, infers column types, and makes the data queryable via SQL in milliseconds. The worker runs off the main thread so the UI stays responsive.

`SharedArrayBuffer` (required for DuckDB's multi-threaded WASM bundle) is enabled by the custom `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin` headers set in `next.config.ts`.

### Chart Recommendation Engine

`src/app/lib/chartUtils.ts` analyzes the loaded schema to determine which columns are numeric, categorical, or temporal. It pairs these with a zero-shot semantic classifier (`columnClassifier.ts`) that uses 50+ pattern rules to label columns (e.g., "measurement", "category", "timestamp") and scores confidence — all in under 1 ms with no model download. Based on this analysis it produces a ranked list of chart recommendations (KPI, Line, Bar, Pie) that are rendered with [Recharts](https://recharts.org/).

### AI Assistant (WebLLM)

On the **Ask AI** tab, Metrx lazy-loads [WebLLM](https://webllm.mlc.ai/) — an in-browser LLM runtime powered by WebGPU. The first visit downloads and caches the **Phi-3.5-mini-instruct** model (~2.4 GB) in the browser's Cache API. Subsequent visits reuse the cached model instantly.

The assistant workflow:
1. User types a natural-language question.
2. `webllm.ts` constructs a schema-aware prompt and calls the LLM to generate SQL.
3. The SQL is executed by DuckDB and results are shown in a result table.
4. The LLM streams a natural-language answer interpreting the results.
5. If the generated SQL is malformed, a `fixSQL()` call automatically repairs it.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) + [React 19](https://react.dev/) |
| Language | [TypeScript 5](https://www.typescriptlang.org/) |
| Data Engine | [DuckDB WASM](https://duckdb.org/docs/api/wasm/overview.html) |
| AI / LLM | [WebLLM](https://webllm.mlc.ai/) — Phi-3.5-mini-instruct (WebGPU) |
| Charts | [Recharts 3](https://recharts.org/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) |
| Linting | [ESLint 9](https://eslint.org/) |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                   # Root route → redirects to /dashboard
│   ├── layout.tsx                 # HTML shell, metadata, fonts
│   ├── globals.css                # Global styles
│   ├── dashboard/
│   │   └── page.tsx               # Dashboard entry point
│   ├── components/
│   │   ├── AppClient.tsx          # Main orchestrator: upload screen + tab navigation
│   │   ├── AppClientWrapper.tsx   # SSR-safe dynamic import wrapper
│   │   ├── DashboardVisuals.tsx   # KPI cards & Recharts visualizations
│   │   ├── AIAssistant.tsx        # Natural-language query UI + WebLLM integration
│   │   └── DataPreviewTable.tsx   # Schema info + raw data table
│   └── lib/
│       ├── webllm.ts              # WebLLM engine singleton (load, cache, stream)
│       ├── chartUtils.ts          # Chart recommendation logic
│       ├── columnClassifier.ts    # Zero-shot semantic column labelling
│       └── duckdb/
│           ├── db-client.ts       # DuckDB client wrapper (talks to worker)
│           └── worker.ts          # Web Worker: DuckDB queries & CSV loading
public/
├── Metrx.png                      # App logo
└── Metrx icon.png                 # Favicon source
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A modern browser with **WebGPU support** for the AI Assistant (Chrome 113+, Edge 113+). All other features work without WebGPU.

### Install & Run

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The app automatically redirects to `/dashboard`.

### Build for Production

```bash
npm run build
npm run start
```

### Lint

```bash
npm run lint
```

---

## Browser Compatibility

| Feature | Requirement |
|---|---|
| CSV Upload & Charts | Any modern browser |
| AI Assistant | WebGPU-enabled browser (Chrome/Edge 113+) |
| Multi-threaded DuckDB | `SharedArrayBuffer` support (enabled by COEP headers) |

> **Note:** The AI Assistant downloads a ~2.4 GB model on first use. It is cached locally and reused on subsequent visits.
