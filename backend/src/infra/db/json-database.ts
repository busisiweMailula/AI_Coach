import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";

type JsonDocument = Record<string, unknown>;
type JsonState = Record<string, JsonDocument[]>;
type IndexDefinition = {
  keys: Record<string, number>;
  unique: boolean;
};
type UpdateDocument = {
  $set?: Record<string, unknown>;
  $setOnInsert?: Record<string, unknown>;
  $inc?: Record<string, number>;
};

export class DuplicateKeyError extends Error {
  readonly code = 11000;

  constructor() {
    super("A record with the same unique key already exists");
    this.name = "DuplicateKeyError";
  }
}

export class JsonDatabase {
  private readonly indexes = new Map<string, IndexDefinition[]>();
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private state: JsonState,
    private readonly filePath: string,
  ) {}

  static async open(filePath: string): Promise<JsonDatabase> {
    await mkdir(path.dirname(filePath), { recursive: true });
    let state: JsonState = {};
    try {
      state = decodeState(JSON.parse(await readFile(filePath, "utf8")) as unknown);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    return new JsonDatabase(state, filePath);
  }

  collection<T extends object = JsonDocument>(name: string): JsonCollection<T> {
    return new JsonCollection<T>(this, name);
  }

  documents(name: string): JsonDocument[] {
    if (!this.state[name]) this.state[name] = [];
    return this.state[name] ?? [];
  }

  async read<T>(read: () => T): Promise<T> {
    await this.writeQueue;
    return read();
  }

  async mutate<T>(mutation: () => T): Promise<T> {
    const operation = this.writeQueue.then(async () => {
      const previousState = cloneValue(this.state);
      const previousIndexes = new Map(
        [...this.indexes.entries()].map(([name, definitions]) => [name, [...definitions]]),
      );
      try {
        const result = mutation();
        await this.persist();
        return result;
      } catch (error) {
        this.state = previousState;
        this.indexes.clear();
        for (const [name, definitions] of previousIndexes) this.indexes.set(name, definitions);
        throw error;
      }
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async createIndex(
    collectionName: string,
    keys: Record<string, number>,
    options: { unique?: boolean; name?: string } = {},
  ): Promise<string> {
    const definition = { keys, unique: options.unique ?? false };
    await this.read(() => {
      if (definition.unique) {
        const docs = this.documents(collectionName);
        for (let index = 0; index < docs.length; index += 1) {
          this.assertUnique(collectionName, docs[index] ?? {}, docs, index, definition);
        }
      }
    });
    const current = this.indexes.get(collectionName) ?? [];
    if (!current.some((item) => sameIndex(item, definition))) {
      this.indexes.set(collectionName, [...current, definition]);
    }
    return options.name ?? Object.keys(keys).join("_");
  }

  async dropDatabase(): Promise<void> {
    await this.mutate(() => {
      this.state = {};
      this.indexes.clear();
    });
  }

  assertUnique(
    collectionName: string,
    candidate: JsonDocument,
    docs: JsonDocument[],
    ignoredIndex: number,
    onlyIndex?: IndexDefinition,
  ): void {
    if (candidate._id !== undefined && docs.some((document, index) =>
      index !== ignoredIndex && equivalent(document._id, candidate._id)
    )) {
      throw new DuplicateKeyError();
    }
    const definitions = onlyIndex ? [onlyIndex] : this.indexes.get(collectionName) ?? [];
    for (const definition of definitions) {
      if (!definition.unique) continue;
      const candidateKey = indexKey(candidate, definition);
      if (docs.some((document, index) =>
        index !== ignoredIndex && indexKey(document, definition) === candidateKey
      )) {
        throw new DuplicateKeyError();
      }
    }
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(encodeValue(this.state), null, 2), "utf8");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temporaryPath, this.filePath);
        return;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
}

export class JsonCursor<T extends object> {
  private sortFields: Record<string, number> | undefined;
  private maxResults: number | undefined;

  constructor(private readonly documents: T[]) {}

  sort(fields: Record<string, number>): this {
    this.sortFields = fields;
    return this;
  }

  limit(count: number): this {
    this.maxResults = count;
    return this;
  }

  async toArray(): Promise<T[]> {
    let results = this.documents.map((document) => cloneValue(document));
    if (this.sortFields) results = sortDocuments(results, this.sortFields);
    if (this.maxResults !== undefined) results = results.slice(0, this.maxResults);
    return results;
  }

  async next(): Promise<T | null> {
    return (await this.limit(1).toArray())[0] ?? null;
  }
}

export class JsonCollection<T extends object> {
  constructor(
    private readonly database: JsonDatabase,
    private readonly name: string,
  ) {}

  async createIndex(keys: Record<string, number>, options: { unique?: boolean; name?: string } = {}) {
    return this.database.createIndex(this.name, keys, options);
  }

  find(filter: JsonDocument = {}): JsonCursor<T> {
    const matches = this.database.documents(this.name).filter((document) => matchesFilter(document, filter));
    return new JsonCursor(matches as T[]);
  }

  async findOne(
    filter: JsonDocument = {},
    options: { projection?: Record<string, number>; sort?: Record<string, number> } = {},
  ): Promise<T | null> {
    return this.database.read(() => {
      let docs = this.database.documents(this.name).filter((document) => matchesFilter(document, filter));
      if (options.sort) docs = sortDocuments(docs, options.sort);
      const document = docs[0];
      return document ? projectDocument(document, options.projection) as T : null;
    });
  }

  async countDocuments(filter: JsonDocument = {}): Promise<number> {
    return this.database.read(() =>
      this.database.documents(this.name).filter((document) => matchesFilter(document, filter)).length
    );
  }

  async insertOne(document: T): Promise<{ acknowledged: true; insertedId: ObjectId }> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      const inserted = cloneValue(document) as JsonDocument;
      if (!("_id" in inserted)) inserted._id = new ObjectId();
      this.database.assertUnique(this.name, inserted, docs, -1);
      docs.push(inserted);
      return { acknowledged: true, insertedId: inserted._id as ObjectId };
    });
  }

  async updateOne(
    filter: JsonDocument,
    update: UpdateDocument,
    options: { upsert?: boolean } = {},
  ): Promise<{ acknowledged: true; matchedCount: number; modifiedCount: number; upsertedId?: ObjectId }> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      const index = docs.findIndex((document) => matchesFilter(document, filter));
      if (index >= 0) {
        const current = docs[index];
        if (!current) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        const updated = applyUpdate(current, update, false);
        this.database.assertUnique(this.name, updated, docs, index);
        const modifiedCount = valuesEqual(current, updated) ? 0 : 1;
        docs[index] = updated;
        return { acknowledged: true, matchedCount: 1, modifiedCount };
      }
      if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      const inserted = applyUpdate(baseDocument(filter), update, true);
      if (!("_id" in inserted)) inserted._id = new ObjectId();
      this.database.assertUnique(this.name, inserted, docs, -1);
      docs.push(inserted);
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: inserted._id as ObjectId };
    });
  }

  async updateMany(
    filter: JsonDocument,
    update: UpdateDocument,
  ): Promise<{ acknowledged: true; matchedCount: number; modifiedCount: number }> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      let matchedCount = 0;
      let modifiedCount = 0;
      for (let index = 0; index < docs.length; index += 1) {
        const current = docs[index];
        if (!current || !matchesFilter(current, filter)) continue;
        matchedCount += 1;
        const updated = applyUpdate(current, update, false);
        this.database.assertUnique(this.name, updated, docs, index);
        if (!valuesEqual(current, updated)) modifiedCount += 1;
        docs[index] = updated;
      }
      return { acknowledged: true, matchedCount, modifiedCount };
    });
  }

  async findOneAndUpdate(
    filter: JsonDocument,
    update: UpdateDocument,
    options: { returnDocument?: "before" | "after" } = {},
  ): Promise<T | null> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      const index = docs.findIndex((document) => matchesFilter(document, filter));
      if (index < 0) return null;
      const current = docs[index];
      if (!current) return null;
      const updated = applyUpdate(current, update, false);
      this.database.assertUnique(this.name, updated, docs, index);
      docs[index] = updated;
      return cloneValue(options.returnDocument === "after" ? updated : current) as T;
    });
  }

  async replaceOne(
    filter: JsonDocument,
    replacement: T,
    options: { upsert?: boolean } = {},
  ): Promise<{ acknowledged: true; matchedCount: number; modifiedCount: number; upsertedId?: ObjectId }> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      const index = docs.findIndex((document) => matchesFilter(document, filter));
      const next = cloneValue(replacement) as JsonDocument;
      if (index >= 0) {
        const current = docs[index];
        if (current && !("_id" in next)) next._id = current._id;
        this.database.assertUnique(this.name, next, docs, index);
        docs[index] = next;
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      }
      if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      if (!("_id" in next)) next._id = new ObjectId();
      this.database.assertUnique(this.name, next, docs, -1);
      docs.push(next);
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: next._id as ObjectId };
    });
  }

  async deleteOne(filter: JsonDocument): Promise<{ acknowledged: true; deletedCount: number }> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      const index = docs.findIndex((document) => matchesFilter(document, filter));
      if (index < 0) return { acknowledged: true, deletedCount: 0 };
      docs.splice(index, 1);
      return { acknowledged: true, deletedCount: 1 };
    });
  }

  async deleteMany(filter: JsonDocument): Promise<{ acknowledged: true; deletedCount: number }> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      const remaining = docs.filter((document) => !matchesFilter(document, filter));
      const deletedCount = docs.length - remaining.length;
      if (deletedCount > 0) docs.splice(0, docs.length, ...remaining);
      return { acknowledged: true, deletedCount };
    });
  }

  async bulkWrite(operations: Array<{
    updateOne: {
      filter: JsonDocument;
      update: UpdateDocument;
      upsert?: boolean;
    };
  }>): Promise<{ acknowledged: true; matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    return this.database.mutate(() => {
      const docs = this.database.documents(this.name);
      let matchedCount = 0;
      let modifiedCount = 0;
      let upsertedCount = 0;
      for (const { updateOne } of operations) {
        const index = docs.findIndex((document) => matchesFilter(document, updateOne.filter));
        if (index >= 0) {
          const current = docs[index];
          if (!current) continue;
          const updated = applyUpdate(current, updateOne.update, false);
          this.database.assertUnique(this.name, updated, docs, index);
          matchedCount += 1;
          if (!valuesEqual(current, updated)) modifiedCount += 1;
          docs[index] = updated;
        } else if (updateOne.upsert) {
          const inserted = applyUpdate(baseDocument(updateOne.filter), updateOne.update, true);
          if (!("_id" in inserted)) inserted._id = new ObjectId();
          this.database.assertUnique(this.name, inserted, docs, -1);
          docs.push(inserted);
          upsertedCount += 1;
        }
      }
      return { acknowledged: true, matchedCount, modifiedCount, upsertedCount };
    });
  }
}

function matchesFilter(document: JsonDocument, filter: JsonDocument): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = getPath(document, key);
    if (isOperatorObject(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === "$in") {
          return Array.isArray(value) && value.some((candidate) => equivalent(actual, candidate));
        }
        if (operator === "$gte") return compareValues(actual, value) >= 0;
        if (operator === "$gt") return compareValues(actual, value) > 0;
        if (operator === "$lte") return compareValues(actual, value) <= 0;
        if (operator === "$lt") return compareValues(actual, value) < 0;
        if (operator === "$ne") return !equivalent(actual, value);
        if (operator === "$exists") return (actual !== undefined) === Boolean(value);
        throw new Error(`Unsupported JSON database query operator: ${operator}`);
      });
    }
    return Array.isArray(actual)
      ? actual.some((item) => equivalent(item, expected))
      : equivalent(actual, expected);
  });
}

function applyUpdate(document: JsonDocument, update: UpdateDocument, isInsert: boolean): JsonDocument {
  const updated = cloneValue(document);
  for (const [field, value] of Object.entries(update.$set ?? {})) setPath(updated, field, value);
  if (isInsert) {
    for (const [field, value] of Object.entries(update.$setOnInsert ?? {})) {
      if (getPath(updated, field) === undefined) setPath(updated, field, value);
    }
  }
  for (const [field, amount] of Object.entries(update.$inc ?? {})) {
    const current = getPath(updated, field);
    setPath(updated, field, (typeof current === "number" ? current : 0) + amount);
  }
  return updated;
}

function baseDocument(filter: JsonDocument): JsonDocument {
  const document: JsonDocument = {};
  for (const [field, value] of Object.entries(filter)) {
    if (!isOperatorObject(value)) setPath(document, field, value);
  }
  return document;
}

function projectDocument(document: JsonDocument, projection?: Record<string, number>): JsonDocument {
  if (!projection) return cloneValue(document);
  const included = Object.entries(projection).filter(([, value]) => value === 1).map(([field]) => field);
  if (included.length > 0) {
    const result: JsonDocument = {};
    for (const field of included) {
      const value = getPath(document, field);
      if (value !== undefined) setPath(result, field, value);
    }
    if (projection._id !== 0 && document._id !== undefined) result._id = cloneValue(document._id);
    return result;
  }
  const result = cloneValue(document);
  for (const [field, value] of Object.entries(projection)) {
    if (value === 0) deletePath(result, field);
  }
  return result;
}

function sortDocuments<T extends object>(documents: T[], fields: Record<string, number>): T[] {
  return [...documents].sort((left, right) => {
    for (const [field, direction] of Object.entries(fields)) {
      const comparison = compareValues(getPath(left, field), getPath(right, field));
      if (comparison !== 0) return comparison * direction;
    }
    return 0;
  });
}

function compareValues(left: unknown, right: unknown): number {
  const a = sortableValue(left);
  const b = sortableValue(right);
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  const first = String(a);
  const second = String(b);
  return first < second ? -1 : first > second ? 1 : 0;
}

function sortableValue(value: unknown): string | number | undefined {
  if (value instanceof Date) return value.getTime();
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === "string" || typeof value === "number") return value;
  return value === null || value === undefined ? undefined : JSON.stringify(encodeValue(value));
}

function equivalent(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equivalent(item, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    return JSON.stringify(encodeValue(left)) === JSON.stringify(encodeValue(right));
  }
  return left === right;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(encodeValue(left)) === JSON.stringify(encodeValue(right));
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof ObjectId) && !(value instanceof Date) &&
    Object.keys(value).some((key) => key.startsWith("$")));
}

function getPath(source: object, pathName: string): unknown {
  return pathName.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as JsonDocument)[part];
  }, source);
}

function setPath(target: JsonDocument, pathName: string, value: unknown): void {
  const parts = pathName.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== "object" || Array.isArray(child)) current[part] = {};
    current = current[part] as JsonDocument;
  }
  const leaf = parts[parts.length - 1];
  if (leaf !== undefined) current[leaf] = cloneValue(value);
}

function deletePath(target: JsonDocument, pathName: string): void {
  const parts = pathName.split(".");
  let current: JsonDocument = target;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== "object" || Array.isArray(child)) return;
    current = child as JsonDocument;
  }
  const leaf = parts[parts.length - 1];
  if (leaf !== undefined) delete current[leaf];
}

function indexKey(document: JsonDocument, index: IndexDefinition): string {
  return JSON.stringify(Object.keys(index.keys).map((field) => encodeValue(getPath(document, field))));
}

function sameIndex(left: IndexDefinition, right: IndexDefinition): boolean {
  return left.unique === right.unique && JSON.stringify(left.keys) === JSON.stringify(right.keys);
}

function cloneValue<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    const copy: JsonDocument = {};
    for (const [key, nested] of Object.entries(value)) copy[key] = cloneValue(nested);
    return copy as T;
  }
  return value;
}

function encodeValue(value: unknown): unknown {
  if (value instanceof ObjectId) return { $oid: value.toHexString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeValue(nested)]));
  }
  return value;
}

function decodeState(value: unknown): JsonState {
  const decoded = decodeValue(value);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("JSON database file must contain an object of collections");
  }
  const state: JsonState = {};
  for (const [name, documents] of Object.entries(decoded)) {
    if (!Array.isArray(documents) || documents.some((document) =>
      !document || typeof document !== "object" || Array.isArray(document)
    )) {
      throw new Error(`JSON database collection "${name}" must contain an array of documents`);
    }
    state[name] = documents as JsonDocument[];
  }
  return state;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value);
  if (entries.length === 1 && typeof value === "object" && "$oid" in value &&
      typeof (value as { $oid: unknown }).$oid === "string") {
    return new ObjectId((value as { $oid: string }).$oid);
  }
  if (entries.length === 1 && "$date" in value && typeof (value as { $date: unknown }).$date === "string") {
    return new Date((value as { $date: string }).$date);
  }
  return Object.fromEntries(entries.map(([key, nested]) => [key, decodeValue(nested)]));
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
