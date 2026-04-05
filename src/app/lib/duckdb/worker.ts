import * as duckdb from "@duckdb/duckdb-wasm";

// ─── Types ────────────────────────────────────────────────────────────────────

type IncomingMessage =
  | { id: string; type: "LOAD_FILE"; payload: { buffer: ArrayBuffer; fileName: string } }
  | { id: string; type: "QUERY";     payload: { sql: string } };

export type SchemaColumn = {
  column_name: string;
  column_type: string;
  nullable: string;
};

export type LoadFileResult = {
  rows:       Record<string, unknown>[];
  chartRows:  Record<string, unknown>[];
  schema:     SchemaColumn[];
  totalRows:  number;
  fileName:   string;
  durationMs: number;
};

export type QueryResult = { rows: Record<string, unknown>[] };

type OutgoingMessage =
  | { id: string; type: "SUCCESS";      payload: LoadFileResult }
  | { id: string; type: "QUERY_RESULT"; payload: QueryResult    }
  | { id: string; type: "ERROR";        payload: { message: string } };

// ─── Singleton DB ─────────────────────────────────────────────────────────────

let db: duckdb.AsyncDuckDB | null = null;

async function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (db) return db;

  const bundle       = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const engineWorker = await duckdb.createWorker(bundle.mainWorker!);
  const logger       = new duckdb.ConsoleLogger();

  db = new duckdb.AsyncDuckDB(logger, engineWorker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function arrowRowToPlain(
  row: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    const val = row[field];
    obj[field] =
      typeof val === "bigint" ? Number(val)
      : val === null || val === undefined ? null
      : val;
  }
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableToArray(table: any): Record<string, unknown>[] {
  const fields: string[] = table.schema.fields.map((f: { name: string }) => f.name);
  return table.toArray().map((row: Record<string, unknown>) =>
    arrowRowToPlain(row, fields)
  );
}

// ─── Message handler ──────────────────────────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const { id, type, payload } = event.data;
  const post = (msg: OutgoingMessage) => ctx.postMessage(msg);

  // ── Ad-hoc SQL query (used by the AI chat interface) ──────────────────────
  if (type === "QUERY") {
    try {
      const database = await getDB();
      const conn     = await database.connect();
      try {
        const table = await conn.query((payload as { sql: string }).sql);
        post({ id, type: "QUERY_RESULT", payload: { rows: tableToArray(table) } });
      } finally {
        await conn.close();
      }
    } catch (err) {
      post({ id, type: "ERROR", payload: { message: err instanceof Error ? err.message : String(err) } });
    }
    return;
  }

  if (type !== "LOAD_FILE") return;

  try {
    const { buffer, fileName } = payload;
    const t0       = performance.now();
    const database = await getDB();

    await database.registerFileBuffer(fileName, new Uint8Array(buffer));

    const conn = await database.connect();
    try {
      await conn.query(`
        CREATE OR REPLACE TABLE _metrx_ingested AS
          SELECT * FROM read_csv_auto(
            '${fileName}',
            ignore_errors = true,
            all_varchar   = false
          )
      `);

      const [previewTable, chartTable, countTable, schemaTable] = await Promise.all([
        conn.query("SELECT * FROM _metrx_ingested LIMIT 5"),
        conn.query("SELECT * FROM _metrx_ingested LIMIT 500"),
        conn.query("SELECT COUNT(*) AS total FROM _metrx_ingested"),
        conn.query("DESCRIBE _metrx_ingested"),
      ]);

      const rows      = tableToArray(previewTable);
      const chartRows = tableToArray(chartTable);
      const totalRows = Number(tableToArray(countTable)[0].total);
      const schema    = tableToArray(schemaTable).map((r) => ({
        column_name: String(r.column_name ?? ""),
        column_type: String(r.column_type ?? ""),
        nullable:    String(r["null"] ?? r.nullable ?? "YES"),
      }));

      post({
        id,
        type: "SUCCESS",
        payload: { rows, chartRows, schema, totalRows, fileName, durationMs: Math.round(performance.now() - t0) },
      });
    } finally {
      await conn.close();
    }
  } catch (err) {
    post({
      id,
      type: "ERROR",
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
  }
};