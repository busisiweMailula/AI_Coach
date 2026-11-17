import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NotFoundError, ValidationError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import type { FileStorage } from "./file-storage.js";

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root = path.resolve(process.cwd(), env.FILE_STORAGE_DIR)) {
    this.root = path.resolve(root);
  }

  async put(key: string, content: Buffer): Promise<void> {
    const destination = this.resolveKey(key);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, content, { flag: "wx", mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new NotFoundError("Stored file not found");
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.resolveKey(key));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }

  private resolveKey(key: string): string {
    if (!key || key.includes("\0")) {
      throw new ValidationError("Invalid storage key");
    }
    const resolved = path.resolve(this.root, key);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw new ValidationError("Invalid storage key");
    }
    return resolved;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

