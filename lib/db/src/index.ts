import { drizzle } from "drizzle-orm/node-postgres";
import { getTableName, getTableColumns } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

function createMockDb(): DrizzleDb {
  const store = new Map<string, Record<string, unknown>[]>();
  const autoIds = new Map<string, number>();

  function getRows(table: any): Record<string, unknown>[] {
    const name = getTableName(table);
    if (!store.has(name)) store.set(name, []);
    return store.get(name)!;
  }

  function nextId(table: any): number {
    const name = getTableName(table);
    const next = (autoIds.get(name) ?? 0) + 1;
    autoIds.set(name, next);
    return next;
  }

  function buildColMap(table: any): Map<string, string> {
    const map = new Map<string, string>();
    try {
      const cols = getTableColumns(table);
      for (const [jsKey, col] of Object.entries(cols)) {
        if (col && typeof col === "object" && "name" in col) {
          map.set(String((col as any).name), jsKey);
        }
      }
    } catch {
      // ignore
    }
    return map;
  }

  function unwrapParam(val: unknown): unknown {
    if (val && typeof val === "object" && "value" in (val as any)) {
      return (val as any).value;
    }
    return val;
  }

  function evalCondition(row: Record<string, unknown>, cond: any, colMap: Map<string, string>): boolean {
    if (!cond) return true;
    try {
      const chunks: any[] | undefined = cond.queryChunks;
      if (!Array.isArray(chunks)) return true;

      // Check if it's an `and(...)` or nested SQL expressions (no direct Column at top level, or contains SQL objects)
      const hasNestedSql = chunks.some((c) => c && typeof c === "object" && Array.isArray(c.queryChunks));
      if (hasNestedSql) {
        const chunkText = chunks
          .filter((c) => c && typeof c === "object" && Array.isArray(c.value))
          .map((c) => c.value.join(""))
          .join("");
        const isOr = /\bor\b/i.test(chunkText);
        const subConds = chunks.filter((c) => c && typeof c === "object" && Array.isArray(c.queryChunks));
        if (subConds.length === 0) return true;
        return isOr
          ? subConds.some((sc) => evalCondition(row, sc, colMap))
          : subConds.every((sc) => evalCondition(row, sc, colMap));
      }

      // Single predicate: find Column chunk and operator text
      const colChunk = chunks.find((c) => c && typeof c === "object" && "name" in c && "table" in c);
      if (!colChunk) return true;

      const jsKey = colMap.get(colChunk.name) ?? colChunk.name;
      const rowVal = row[jsKey];
      const text = chunks
        .filter((c) => c && typeof c === "object" && Array.isArray(c.value))
        .map((c) => c.value.join(""))
        .join(" ");

      if (/is not null/i.test(text)) {
        return rowVal !== null && rowVal !== undefined;
      }
      if (/is null/i.test(text)) {
        return rowVal === null || rowVal === undefined;
      }
      if (/\bin\b/i.test(text)) {
        const listChunks = chunks.filter(
          (c) => c !== colChunk && !(c && typeof c === "object" && Array.isArray(c.value))
        );
        const flatVals: unknown[] = [];
        for (const item of listChunks) {
          if (Array.isArray(item)) {
            for (const sub of item) flatVals.push(unwrapParam(sub));
          } else {
            const unwrapped = unwrapParam(item);
            if (Array.isArray(unwrapped)) flatVals.push(...unwrapped);
            else flatVals.push(unwrapped);
          }
        }
        return flatVals.includes(rowVal);
      }
      if (/=/.test(text)) {
        const valChunk = chunks.find(
          (c) => c !== colChunk && !(c && typeof c === "object" && Array.isArray(c.value))
        );
        const targetVal = unwrapParam(valChunk);
        return rowVal === targetVal;
      }
    } catch {
      return true;
    }
    return true;
  }

  function applyDefaults(table: any, values: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = { ...values };
    try {
      const cols = getTableColumns(table);
      for (const [jsKey, col] of Object.entries(cols)) {
        if (row[jsKey] === undefined) {
          if (jsKey === "id") {
            row[jsKey] = nextId(table);
          } else if ((col as any).defaultNow) {
            row[jsKey] = new Date();
          } else if ((col as any).hasDefault && (col as any).default !== undefined) {
            row[jsKey] = (col as any).default;
          } else {
            row[jsKey] = null;
          }
        }
      }
    } catch {
      if (row.id === undefined) row.id = nextId(table);
      if (row.createdAt === undefined) row.createdAt = new Date();
    }
    return row;
  }

  const mockDb = {
    select(projection?: Record<string, any>) {
      let targetTable: any = null;
      let whereCond: any = null;
      let limitVal: number | undefined;
      let offsetVal = 0;

      const executeSelect = () => {
        if (!targetTable) return [];
        const rows = getRows(targetTable);
        const colMap = buildColMap(targetTable);
        let filtered = whereCond ? rows.filter((r) => evalCondition(r, whereCond, colMap)) : [...rows];

        // Aggregate stats projection (used by /api/stats)
        if (projection && ("totalJobs" in projection || "totalPublished" in projection)) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          return [
            {
              totalJobs: filtered.length,
              publishedToday: filtered.filter(
                (r) => r.status === "published" && r.createdAt instanceof Date && r.createdAt >= todayStart
              ).length,
              pendingJobs: filtered.filter((r) =>
                ["pending", "ready", "approved"].includes(String(r.status))
              ).length,
              failedJobs: filtered.filter((r) => r.status === "failed").length,
              totalPublished: filtered.filter((r) => r.status === "published").length,
              processingJobs: filtered.filter((r) =>
                ["downloading", "processing", "generating", "publishing"].includes(String(r.status))
              ).length,
            },
          ];
        }

        if (offsetVal > 0) filtered = filtered.slice(offsetVal);
        if (limitVal !== undefined) filtered = filtered.slice(0, limitVal);

        if (projection) {
          return filtered.map((row) => {
            const projected: Record<string, unknown> = {};
            for (const [alias, col] of Object.entries(projection)) {
              if (col && typeof col === "object" && "name" in col) {
                const jsKey = colMap.get((col as any).name) ?? alias;
                projected[alias] = row[jsKey];
              } else {
                projected[alias] = row[alias] ?? 0;
              }
            }
            return projected;
          });
        }
        return filtered.map((r) => ({ ...r }));
      };

      const builder: any = {
        from(table: any) {
          targetTable = table;
          return builder;
        },
        where(cond: any) {
          whereCond = cond;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit(n: number) {
          limitVal = n;
          return builder;
        },
        offset(n: number) {
          offsetVal = n;
          return builder;
        },
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve(executeSelect()).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    insert(table: any) {
      let inputValues: Record<string, unknown>[] = [];
      let conflictConfig: { target: any; set: Record<string, unknown> } | null = null;

      const executeInsert = () => {
        const rows = getRows(table);
        const colMap = buildColMap(table);
        const inserted: Record<string, unknown>[] = [];

        for (const item of inputValues) {
          if (conflictConfig) {
            const targets = Array.isArray(conflictConfig.target)
              ? conflictConfig.target
              : [conflictConfig.target];
            const targetKeys = targets.map((t: any) => colMap.get(t?.name) ?? t?.name).filter(Boolean);
            const existing = rows.find((r) => targetKeys.every((k: string) => r[k] === item[k]));
            if (existing) {
              Object.assign(existing, conflictConfig.set);
              inserted.push({ ...existing });
              continue;
            }
          }
          const newRow = applyDefaults(table, item);
          rows.unshift(newRow);
          inserted.push({ ...newRow });
        }
        return inserted;
      };

      const builder: any = {
        values(vals: Record<string, unknown> | Record<string, unknown>[]) {
          inputValues = Array.isArray(vals) ? vals : [vals];
          return builder;
        },
        onConflictDoUpdate(cfg: { target: any; set: Record<string, unknown> }) {
          conflictConfig = cfg;
          return builder;
        },
        returning() {
          return Promise.resolve(executeInsert());
        },
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve(executeInsert()).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    update(table: any) {
      let patch: Record<string, unknown> = {};
      let whereCond: any = null;

      const executeUpdate = () => {
        const rows = getRows(table);
        const colMap = buildColMap(table);
        const updated: Record<string, unknown>[] = [];
        for (const row of rows) {
          if (!whereCond || evalCondition(row, whereCond, colMap)) {
            for (const [k, v] of Object.entries(patch)) {
              if (v !== undefined) row[k] = v;
            }
            updated.push({ ...row });
          }
        }
        return updated;
      };

      const builder: any = {
        set(data: Record<string, unknown>) {
          patch = data;
          return builder;
        },
        where(cond: any) {
          whereCond = cond;
          return builder;
        },
        returning() {
          return Promise.resolve(executeUpdate());
        },
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve(executeUpdate()).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    delete(table: any) {
      let whereCond: any = null;

      const executeDelete = () => {
        const rows = getRows(table);
        const colMap = buildColMap(table);
        if (!whereCond) {
          rows.length = 0;
          return [];
        }
        const kept = rows.filter((r) => !evalCondition(r, whereCond, colMap));
        rows.splice(0, rows.length, ...kept);
        return [];
      };

      const builder: any = {
        where(cond: any) {
          whereCond = cond;
          return builder;
        },
        returning() {
          return Promise.resolve(executeDelete());
        },
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve(executeDelete()).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };

  return mockDb as unknown as DrizzleDb;
}

let pool: pg.Pool | null = null;
let db: DrizzleDb;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", (error) => {
      console.error("[DB POOL ERROR]", error);
    });
    db = drizzle(pool, { schema });
  } catch (err) {
    console.warn("[AI Studio] Database connection failed — using in-memory mock", err);
    db = createMockDb();
  }
} else {
  console.warn("[AI Studio] DATABASE_URL not set — using in-memory database mock");
  db = createMockDb();
}

export { pool, db };
export * from "./schema/index.js";
