import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CacheError } from "../core/errors.js";

interface Envelope<T> {
  schemaVersion: number;
  data: T;
}

/**
 * Reads a versioned JSON store. Returns `undefined` when the file is missing,
 * unreadable, corrupt, or written by a different schema version — callers
 * treat that as "cold cache" and rebuild, so the cache is self-healing.
 */
export async function readJsonStore<T>(
  filePath: string,
  schemaVersion: number,
): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const envelope = JSON.parse(text) as Envelope<T>;
    if (envelope.schemaVersion !== schemaVersion) return undefined;
    return envelope.data;
  } catch {
    return undefined;
  }
}

/**
 * Atomically writes a versioned JSON store: write to a temp sibling, then
 * rename over the target. On Windows, rename onto an existing file can
 * transiently fail (EPERM) when scanners hold the handle; one remove+rename
 * retry covers that.
 */
export async function writeJsonStore<T>(
  filePath: string,
  schemaVersion: number,
  data: T,
): Promise<void> {
  const envelope: Envelope<T> = { schemaVersion, data };
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(envelope), "utf8");
    try {
      await rename(tmp, filePath);
    } catch {
      await rm(filePath, { force: true });
      await rename(tmp, filePath);
    }
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new CacheError(`Failed to write cache file ${filePath}`, error);
  }
}
