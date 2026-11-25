import { ObjectId, type Document } from "mongodb";

export type PostgresColumnType =
  | "TEXT"
  | "BOOLEAN"
  | "DOUBLE PRECISION"
  | "TIMESTAMPTZ"
  | "JSONB";

export interface MigratedField {
  sourceName: string;
  columnName: string;
  type: PostgresColumnType;
}

export interface CollectionShape {
  sourceName: string;
  tableName: string;
  fields: MigratedField[];
  count: number;
}

export function auditLogsCollectionShape(count: number): CollectionShape {
  return {
    sourceName: "audit_logs",
    tableName: "audit_logs",
    count,
    fields: [
      { sourceName: "actorId", columnName: "actor_id", type: "TEXT" },
      { sourceName: "targetId", columnName: "target_id", type: "TEXT" },
      { sourceName: "ownerId", columnName: "owner_id", type: "TEXT" },
      { sourceName: "action", columnName: "action", type: "TEXT" },
      { sourceName: "targetType", columnName: "target_type", type: "TEXT" },
      { sourceName: "previousRole", columnName: "previous_role", type: "TEXT" },
      { sourceName: "newRole", columnName: "new_role", type: "TEXT" },
      { sourceName: "previousStatus", columnName: "previous_status", type: "TEXT" },
      { sourceName: "newStatus", columnName: "new_status", type: "TEXT" },
      { sourceName: "requestId", columnName: "request_id", type: "TEXT" },
      { sourceName: "reason", columnName: "reason", type: "TEXT" },
      { sourceName: "createdAt", columnName: "created_at", type: "TIMESTAMPTZ" },
    ],
  };
}

export function fieldColumnName(fieldName: string): string {
  const columnName = fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const result = /^[a-z]/.test(columnName) ? columnName : `field_${columnName || "value"}`;
  if (result.length > 63) {
    throw new Error(`Mongo field or collection name exceeds PostgreSQL's 63-character limit`);
  }
  return result;
}

export function postgresValue(value: unknown, type: PostgresColumnType): unknown {
  if (value === null || value === undefined) return null;
  if (type === "JSONB") return JSON.stringify(jsonCompatible(value));
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value;
  return value;
}

export function jsonCompatible(value: unknown): unknown {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonCompatible);
  if (value && typeof value === "object") {
    if (Buffer.isBuffer(value)) return value.toString("base64");
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonCompatible(nested)]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function analyzeCollection(
  collectionName: string,
  documents: Document[],
): CollectionShape {
  const typesByField = new Map<string, Set<string>>();

  for (const document of documents) {
    for (const [sourceName, value] of Object.entries(document)) {
      if (sourceName === "_id") continue;
      const types = typesByField.get(sourceName) ?? new Set<string>();
      if (value !== null && value !== undefined) types.add(valueType(value));
      typesByField.set(sourceName, types);
    }
  }

  return collectionShape(collectionName, documents.length, typesByField);
}

export function collectionShape(
  collectionName: string,
  count: number,
  typesByField: Map<string, Set<string>>,
): CollectionShape {
  const columnSources = new Map<string, string>();
  const fields = [...typesByField.entries()].map(([sourceName, types]) => {
    const columnName = fieldColumnName(sourceName);
    const priorSourceName = columnSources.get(columnName);
    if (priorSourceName && priorSourceName !== sourceName) {
      throw new Error(
        `Mongo fields "${priorSourceName}" and "${sourceName}" map to the same PostgreSQL column "${columnName}" in "${collectionName}"`,
      );
    }
    if (columnName === "mongo_id") {
      throw new Error(`Mongo field "${sourceName}" conflicts with the PostgreSQL primary key in "${collectionName}"`);
    }
    columnSources.set(columnName, sourceName);
    return {
      sourceName,
      columnName,
      type: postgresTypeForKinds(types),
    };
  });

  return {
    sourceName: collectionName,
    tableName: fieldColumnName(collectionName),
    count,
    fields: fields.sort((left, right) => left.columnName.localeCompare(right.columnName)),
  };
}

export function valueType(value: unknown): string {
  if (value instanceof ObjectId) return "objectId";
  if (value instanceof Date) return "date";
  if (Array.isArray(value) || (value !== null && typeof value === "object")) return "json";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return typeof value;
}

function postgresTypeForKinds(types: Set<string>): PostgresColumnType {
  if (types.size === 0 || types.has("json")) return "JSONB";
  if (types.size > 1) return "JSONB";
  const type = [...types][0];
  if (type === "objectId" || type === "string") return "TEXT";
  if (type === "boolean") return "BOOLEAN";
  if (type === "number") return "DOUBLE PRECISION";
  if (type === "date") return "TIMESTAMPTZ";
  return "JSONB";
}

export function postgresTypeForValues(values: unknown[]): PostgresColumnType {
  return postgresTypeForKinds(
    new Set(values.filter((value) => value !== null && value !== undefined).map(valueType)),
  );
}
