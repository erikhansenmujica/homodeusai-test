import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertCleanWorkingTree,
  inspectTrackedSubmission,
  ROOT,
  sha256File,
} from "./submission-lib.ts";

assertCleanWorkingTree();
const summary = inspectTrackedSubmission();
const outputDirectory = join(ROOT, "dist");
const archivePath = join(outputDirectory, "nexo-atlantico-knowledge-case.tgz");
const checksumPath = `${archivePath}.sha256`;

mkdirSync(outputDirectory, { recursive: true });
execFileSync("git", [
  "archive",
  "--format=tar.gz",
  `--output=${archivePath}`,
  summary.commit,
], { cwd: ROOT, stdio: "inherit" });

const checksum = sha256File(archivePath);
writeFileSync(checksumPath, `${checksum}  nexo-atlantico-knowledge-case.tgz\n`, {
  encoding: "utf8",
  mode: 0o600,
});

console.log(JSON.stringify({
  status: "exported",
  archivePath,
  checksumPath,
  checksum,
  ...summary,
}, null, 2));
