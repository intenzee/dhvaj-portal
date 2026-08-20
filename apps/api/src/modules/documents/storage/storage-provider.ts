/**
 * Blob storage abstraction (Phase 10).
 *
 * The database is the system of record for document *metadata*; the bytes live
 * behind this interface. Two implementations plug in behind the same contract,
 * selected by `STORAGE_PROVIDER`:
 *
 *   - `local`      — a filesystem provider for development/test (the default).
 *   - `azure_blob` — Azure Blob Storage for production.
 *
 * References are opaque, application-minted keys (never client-supplied and
 * never returned to clients), so possessing a document id can never be turned
 * into a direct, RLS-bypassing fetch of the bytes.
 */
export interface StorageProvider {
  /** A short identifier for logs/health (e.g. "local", "azure_blob"). */
  readonly name: string;

  /**
   * Mint a fresh opaque storage reference for a new version's bytes. Namespaced
   * by engagement + document so the physical layout is auditable, with a random
   * component so references are unguessable.
   */
  newReference(engagementId: string, documentId: string): string;

  /** Persist the bytes at the given reference. */
  write(reference: string, data: Buffer, contentType: string): Promise<void>;

  /** Read the bytes back. Rejects if the reference is unknown. */
  read(reference: string): Promise<Buffer>;

  /**
   * Remove the bytes (best-effort). Used only for compensating a failed upload
   * whose metadata never committed — professional evidence is never deleted
   * through the normal API surface.
   */
  remove(reference: string): Promise<void>;
}

/** DI token for the selected {@link StorageProvider}. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
