"use client";

export type { SchemaColumn, LoadFileResult, QueryResult, AdditionalTable } from "./worker";

import type { LoadFileResult, QueryResult, AdditionalTable } from "./worker";

// Generic pending slot — resolve payload is typed at the call site
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject:  (reason: Error) => void;
};

type WorkerResponse =
  | { id: string; type: "SUCCESS";                 payload: LoadFileResult        }
  | { id: string; type: "ADDITIONAL_FILE_SUCCESS"; payload: AdditionalTable       }
  | { id: string; type: "DROP_SUCCESS";            payload: { tableName: string } }
  | { id: string; type: "QUERY_RESULT";            payload: QueryResult           }
  | { id: string; type: "ERROR";                   payload: { message: string }   };

class DuckDBClient {
  private worker:  Worker | null = null;
  private pending  = new Map<string, PendingRequest>();
  private counter  = 0;

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    this.worker = new Worker(
      new URL("./worker.ts", import.meta.url),
      { type: "module" }
    );

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, type, payload } = event.data;
      const req = this.pending.get(id);
      if (!req) return;
      this.pending.delete(id);

      if (type === "ERROR") {
        req.reject(new Error((payload as { message: string }).message));
      } else {
        req.resolve(payload);
      }
    };

    this.worker.onerror = (err) => {
      console.error("[DuckDBClient] Worker error:", err);
      this.pending.forEach(({ reject }) =>
        reject(new Error("DuckDB worker crashed."))
      );
      this.pending.clear();
      this.worker = null;
    };

    return this.worker;
  }

  async loadFile(file: File): Promise<LoadFileResult> {
    const id     = `req_${++this.counter}_${Date.now()}`;
    const buffer = await file.arrayBuffer();

    return new Promise<LoadFileResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as LoadFileResult),
        reject,
      });
      // Transfer the ArrayBuffer — zero-copy, O(1) regardless of file size
      this.getWorker().postMessage(
        { id, type: "LOAD_FILE", payload: { buffer, fileName: file.name } },
        [buffer]
      );
    });
  }

  /** Load a second (or Nth) file as a new table without dropping existing tables. */
  async loadAdditionalFile(file: File): Promise<AdditionalTable> {
    const id     = `req_${++this.counter}_${Date.now()}`;
    const buffer = await file.arrayBuffer();

    return new Promise<AdditionalTable>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as AdditionalTable),
        reject,
      });
      this.getWorker().postMessage(
        { id, type: "LOAD_ADDITIONAL_FILE", payload: { buffer, fileName: file.name } },
        [buffer],
      );
    });
  }

  /** Drop a previously loaded additional table by name. */
  async dropTable(tableName: string): Promise<void> {
    const id = `req_${++this.counter}_${Date.now()}`;

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
      });
      this.getWorker().postMessage({ id, type: "DROP_TABLE", payload: { tableName } });
    });
  }

  /** Run an arbitrary DuckDB SQL query against the ingested table. */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    const id = `req_${++this.counter}_${Date.now()}`;

    return new Promise<Record<string, unknown>[]>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve((v as QueryResult).rows),
        reject,
      });
      this.getWorker().postMessage({ id, type: "QUERY", payload: { sql } });
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.forEach(({ reject }) => reject(new Error("Client terminated.")));
    this.pending.clear();
  }
}

let _instance: DuckDBClient | null = null;

export function getDuckDBClient(): DuckDBClient {
  if (!_instance) _instance = new DuckDBClient();
  return _instance;
}
