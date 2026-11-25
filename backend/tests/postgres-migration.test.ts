import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  auditLogsCollectionShape,
  analyzeCollection,
  fieldColumnName,
  postgresValue,
} from "../src/infra/db/postgres-migration.js";

describe("MongoDB to PostgreSQL migration mapping", () => {
  it("maps common document fields to typed SQL columns and nested values to JSONB", () => {
    const ownerId = new ObjectId("65f0c0a3f6b8a7b123456789");
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    const shape = analyzeCollection("audit_logs", [{
      _id: new ObjectId("65f0c0a3f6b8a7b123456780"),
      ownerId,
      action: "user_registered",
      active: true,
      createdAt,
      metadata: { relatedId: ownerId, occurredAt: createdAt },
    }]);

    expect(shape.tableName).toBe("audit_logs");
    expect(shape.fields).toEqual(expect.arrayContaining([
      { sourceName: "ownerId", columnName: "owner_id", type: "TEXT" },
      { sourceName: "action", columnName: "action", type: "TEXT" },
      { sourceName: "active", columnName: "active", type: "BOOLEAN" },
      { sourceName: "createdAt", columnName: "created_at", type: "TIMESTAMPTZ" },
      { sourceName: "metadata", columnName: "metadata", type: "JSONB" },
    ]));
    expect(postgresValue(ownerId, "TEXT")).toBe(ownerId.toHexString());
    expect(JSON.parse(postgresValue({
      relatedId: ownerId,
      occurredAt: createdAt,
    }, "JSONB") as string)).toEqual({
      relatedId: ownerId.toHexString(),
      occurredAt: createdAt.toISOString(),
    });
  });

  it("uses JSONB for mixed field types and rejects ambiguous column names", () => {
    expect(analyzeCollection("records", [
      { _id: new ObjectId(), value: "text" },
      { _id: new ObjectId(), value: 10 },
    ]).fields).toEqual([
      { sourceName: "value", columnName: "value", type: "JSONB" },
    ]);

    expect(() => analyzeCollection("records", [
      { _id: new ObjectId(), mongo_id: "conflicts with primary key" },
    ])).toThrow("conflicts with the PostgreSQL primary key");
    expect(fieldColumnName("roleType")).toBe("role_type");
  });

  it("uses the same typed audit table shape as runtime audit storage", () => {
    const shape = auditLogsCollectionShape(3);
    expect(shape.tableName).toBe("audit_logs");
    expect(shape.count).toBe(3);
    expect(shape.fields.find(({ sourceName }) => sourceName === "createdAt"))
      .toEqual({ sourceName: "createdAt", columnName: "created_at", type: "TIMESTAMPTZ" });
    expect(shape.fields.filter(({ type }) => type !== "TEXT" && type !== "TIMESTAMPTZ"))
      .toEqual([]);
  });
});
