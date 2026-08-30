import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { blocked } from "./errors.js";

export function readSafeRegularFile(path, {
  maximumBytes,
  privateFile = false,
  allowedOwners = [process.getuid?.(), 0].filter(Number.isInteger)
}) {
  if (typeof path !== "string" || !isAbsolute(path)) blocked("file_path");
  const resolved = resolve(path);
  const before = safeLstat(resolved);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    blocked("file_type");
  }
  if (!allowedOwners.includes(before.uid)) blocked("file_owner");
  if ((before.mode & 0o022) !== 0 || privateFile && (before.mode & 0o077) !== 0) {
    blocked("file_mode");
  }
  if (before.size <= 0 || before.size > maximumBytes) blocked("file_size");
  const descriptor = openSync(
    resolved,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  try {
    const after = fstatSync(descriptor);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.nlink !== 1 ||
        !allowedOwners.includes(after.uid) || (after.mode & 0o022) !== 0 ||
        privateFile && (after.mode & 0o077) !== 0) blocked("file_race");
    const bytes = Buffer.allocUnsafe(after.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) blocked("file_short_read");
      offset += count;
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export function atomicWriteFile(path, bytes, { mode = 0o600 } = {}) {
  if (typeof path !== "string" || !isAbsolute(path) ||
      !Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) blocked("write_path");
  const resolved = resolve(path);
  if (basename(resolved) !== basename(path) || [".", ".."].includes(basename(path))) {
    blocked("write_path");
  }
  const directory = dirname(resolved);
  const directoryBefore = safeLstat(directory);
  if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink() ||
      directoryBefore.uid !== process.getuid?.() ||
      (directoryBefore.mode & 0o022) !== 0) blocked("write_directory");
  try {
    lstatSync(resolved);
    blocked("write_overwrite");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const suffix = randomBytes(12).toString("hex");
  const temporary = join(directory, `.${basename(resolved)}.${suffix}.tmp`);
  let descriptor;
  let published = false;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      mode
    );
    fchmodSync(descriptor, mode);
    let offset = 0;
    const buffer = Buffer.from(bytes);
    while (offset < buffer.length) {
      offset += writeSync(descriptor, buffer, offset, buffer.length - offset);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const directoryAfter = safeLstat(directory);
    if (directoryAfter.dev !== directoryBefore.dev ||
        directoryAfter.ino !== directoryBefore.ino) blocked("write_directory_race");
    linkSync(temporary, resolved);
    published = true;
    unlinkSync(temporary);
    const publishedStat = safeLstat(resolved);
    if (!publishedStat.isFile() || publishedStat.isSymbolicLink() ||
        publishedStat.nlink !== 1 || publishedStat.uid !== process.getuid?.() ||
        (publishedStat.mode & 0o777) !== mode) {
      blocked("write_publish");
    }
    const directoryDescriptor = openSync(
      directory,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) |
        (constants.O_NOFOLLOW ?? 0)
    );
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (published) {
      try {
        const destination = safeLstat(resolved);
        if (!destination.isFile() || destination.isSymbolicLink() ||
            destination.uid !== process.getuid?.() || destination.nlink !== 1) {
          blocked("write_cleanup_unsafe");
        }
        unlinkSync(resolved);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") blocked("write_cleanup");
      }
    }
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") blocked("write_cleanup");
    }
    throw error;
  }
}

function safeLstat(path) {
  try {
    return lstatSync(path, { bigint: false });
  } catch {
    blocked("file_unavailable");
  }
}
