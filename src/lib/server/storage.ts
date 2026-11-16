import "server-only";
import { and, eq } from "drizzle-orm";
import { type Conn, db as defaultDb } from "@/lib/db/client";
import { receiptFiles, type ReceiptFileKind } from "@/lib/db/schema";
import type { UploadType } from "@/lib/domain/files";

export type StoredFile = { mimeType: UploadType; data: Buffer };

/**
 * Where receipt bytes live (ADR-027). Every call is scoped by the owner; keys are never
 * built from client input other than an id already checked to belong to that owner.
 */
export interface StorageAdapter {
  put(
    userId: string,
    receiptId: string,
    kind: ReceiptFileKind,
    file: StoredFile,
    conn?: Conn,
  ): Promise<void>;
  get(userId: string, receiptId: string, kind: ReceiptFileKind): Promise<StoredFile | null>;
}

/** Bytes in the `receipt_files` table; deleted with their receipt (FK cascade). */
export const postgresStorage: StorageAdapter = {
  async put(userId, receiptId, kind, file, conn = defaultDb) {
    await conn
      .insert(receiptFiles)
      .values({
        userId,
        receiptId,
        kind,
        mimeType: file.mimeType,
        sizeBytes: file.data.byteLength,
        data: file.data,
      })
      .onConflictDoUpdate({
        target: [receiptFiles.userId, receiptFiles.receiptId, receiptFiles.kind],
        set: { mimeType: file.mimeType, sizeBytes: file.data.byteLength, data: file.data },
      });
  },

  async get(userId, receiptId, kind) {
    const [row] = await defaultDb
      .select({ mimeType: receiptFiles.mimeType, data: receiptFiles.data })
      .from(receiptFiles)
      .where(
        and(
          eq(receiptFiles.userId, userId),
          eq(receiptFiles.receiptId, receiptId),
          eq(receiptFiles.kind, kind),
        ),
      );
    return row ? { mimeType: row.mimeType as UploadType, data: row.data } : null;
  },
};

export const storage: StorageAdapter = postgresStorage;
