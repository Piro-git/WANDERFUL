import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  readFile,
  unlink
} from "node:fs/promises";
import { dirname } from "node:path";
import { basename } from "node:path";
import { MAXIMUM_RECEIPT_BYTES } from "./constants.js";
import { stableSerializeStagingReadinessV1 } from "./serialization.js";

export async function writeStagingReadinessReceiptAtomicV1(
  outputPath,
  receipt,
  options = {}
) {
  assertAuthorizedReceiptPath(outputPath);
  const serialized = `${stableSerializeStagingReadinessV1(receipt)}\n`;
  if (Buffer.byteLength(serialized) > MAXIMUM_RECEIPT_BYTES) {
    throw ioError("receipt_output_too_large");
  }
  const operations = {
    open: options.openImpl ?? open,
    link: options.linkImpl ?? link,
    unlink: options.unlinkImpl ?? unlink,
    syncDirectory: options.syncDirectoryImpl ?? syncDirectory
  };
  const temporaryPath = `${outputPath}.pending-${process.pid}-${randomUUID()}`;
  let handle;
  let linked = false;
  try {
    handle = await operations.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await operations.link(temporaryPath, outputPath);
    linked = true;
    await operations.syncDirectory(dirname(outputPath));
  } catch {
    if (linked) {
      await operations.unlink(outputPath).catch(() => {});
      await operations.syncDirectory(dirname(outputPath)).catch(() => {});
    }
    throw ioError("receipt_atomic_write_failed");
  } finally {
    await handle?.close().catch(() => {});
    await operations.unlink(temporaryPath).catch(() => {});
  }
}

export async function readStagingReadinessReceiptV1(path) {
  assertAuthorizedReceiptPath(path);
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    throw ioError("receipt_unavailable");
  }
  if (!stats.isFile() || stats.isSymbolicLink() ||
      (stats.mode & 0o077) !== 0 || stats.size < 2 ||
      stats.size > MAXIMUM_RECEIPT_BYTES) {
    throw ioError("receipt_permissions_or_size_invalid");
  }
  try {
    const contents = await readFile(path, "utf8");
    const receipt = JSON.parse(contents);
    if (contents !== `${stableSerializeStagingReadinessV1(receipt)}\n`) {
      throw ioError("receipt_not_canonical");
    }
    return receipt;
  } catch {
    throw ioError("receipt_invalid_or_noncanonical_json");
  }
}

export function assertAuthorizedReceiptPath(path) {
  if (typeof path !== "string" || dirname(path) !== "/private/tmp" ||
      !basename(path).startsWith("TrailMindStagingReadinessV1-") ||
      path.includes("..") || path.includes("\0") || path.length > 500) {
    throw ioError("receipt_path_not_authorized");
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!new Set(["EINVAL", "ENOTSUP"]).has(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function ioError(code) {
  const error = new Error(code);
  error.name = "StagingReadinessReceiptIoError";
  error.code = code;
  return error;
}
