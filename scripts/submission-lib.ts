import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 5_000;
const MAX_ENTRIES = 7_500;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DEPTH = 32;
const FORBIDDEN_PREFIXES = ["node_modules/", "models/", ".runtime/", "dist/", ".git/"];

export interface SubmissionSummary {
  commit: string;
  files: number;
  entries: number;
  totalBytes: number;
  maximumFileBytes: number;
  maximumDepth: number;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

export function assertCleanWorkingTree(): void {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]).trim();
  if (status) throw new Error(`Working tree must be clean before export:\n${status}`);
}

export function inspectTrackedSubmission(): SubmissionSummary {
  const output = git(["ls-tree", "-rl", "--full-tree", "HEAD"]);
  const directories = new Set<string>();
  let totalBytes = 0;
  let maximumFileBytes = 0;
  let maximumDepth = 0;
  let files = 0;

  for (const line of output.split("\n").filter(Boolean)) {
    const match = line.match(/^(\d{6})\s+\w+\s+[a-f0-9]+\s+(\d+)\t(.+)$/u);
    if (!match) throw new Error(`Could not parse tracked entry: ${line}`);
    const [, mode, sizeText, path] = match;
    if (mode !== "100644" && mode !== "100755") throw new Error(`Submission contains a non-regular tracked entry: ${path}`);
    if (FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      throw new Error(`Submission contains forbidden generated content: ${path}`);
    }
    const absolute = resolve(ROOT, path);
    if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Submission contains a symlink: ${path}`);
    const size = Number(sizeText);
    if (size > MAX_FILE_BYTES) throw new Error(`Tracked file exceeds 20 MiB: ${path}`);
    totalBytes += size;
    maximumFileBytes = Math.max(maximumFileBytes, size);
    maximumDepth = Math.max(maximumDepth, path.split("/").length);
    files += 1;
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }

  const entries = files + directories.size;
  if (files >= MAX_FILES) throw new Error(`Submission has ${files} files; limit is below ${MAX_FILES}`);
  if (entries >= MAX_ENTRIES) throw new Error(`Submission has ${entries} entries; limit is below ${MAX_ENTRIES}`);
  if (totalBytes >= MAX_TOTAL_BYTES) throw new Error(`Submission is ${totalBytes} bytes; limit is below 100 MiB`);
  if (maximumDepth > MAX_DEPTH) throw new Error(`Submission depth is ${maximumDepth}; limit is ${MAX_DEPTH}`);

  return {
    commit: git(["rev-parse", "HEAD"]).trim(),
    files,
    entries,
    totalBytes,
    maximumFileBytes,
    maximumDepth,
  };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export { ROOT };
