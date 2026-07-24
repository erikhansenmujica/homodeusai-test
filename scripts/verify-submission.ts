import { inspectTrackedSubmission } from "./submission-lib.ts";

const summary = inspectTrackedSubmission();
console.log(JSON.stringify({ status: "valid", ...summary }, null, 2));
