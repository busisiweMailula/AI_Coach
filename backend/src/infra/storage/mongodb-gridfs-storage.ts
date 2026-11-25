import { GridFSBucket, ObjectId } from "mongodb";
import { NotFoundError } from "../../common/errors.js";
import { getMongoDb } from "../db/database.js";
import type { FileStorage } from "./file-storage.js";

const bucketName = "coach_uploads";

export class MongoGridFsStorage implements FileStorage {
  async exists(key: string): Promise<boolean> {
    return (await getMongoDb().collection(`${bucketName}.files`).findOne(
      { filename: key },
      { projection: { _id: 1 } },
    )) !== null;
  }

  async put(key: string, content: Buffer): Promise<void> {
    const upload = this.bucket().openUploadStream(key);
    await new Promise<void>((resolve, reject) => {
      upload.once("finish", resolve);
      upload.once("error", reject);
      upload.end(content);
    });
  }

  async get(key: string): Promise<Buffer> {
    const file = await getMongoDb().collection(`${bucketName}.files`)
      .findOne({ filename: key }, { sort: { uploadDate: -1 } });
    if (!file || !(file._id instanceof ObjectId)) {
      throw new NotFoundError("Stored file not found");
    }

    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket().openDownloadStream(file._id)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const files = await getMongoDb().collection(`${bucketName}.files`)
      .find({ filename: key }, { projection: { _id: 1 } })
      .toArray();
    for (const file of files) {
      if (file._id instanceof ObjectId) await this.bucket().delete(file._id);
    }
  }

  private bucket(): GridFSBucket {
    return new GridFSBucket(getMongoDb(), { bucketName });
  }
}
