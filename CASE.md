# The Nexo Atlântico case

## Monday, 09:10

People Operations serves employees while also running admission, timekeeping, payroll, leave, termination, safety, and data-change workflows. Requests arrive through personal and shared email, collaboration chat, service channels, messaging, spreadsheets, and specialist systems. The team’s core HR platform holds part of the process; finance, identity, health, signature, and global records live elsewhere.

An analyst rarely performs a single lookup. For an employee question, the analyst may need to establish the legal entity, operating base, working relationship, audience, effective date, approval state, and source authority. Senior analysts often know the likely answer from experience. Junior analysts search collective instruments, labor guidance, internal policy, and a limited knowledge assistant, then copy the result into the channel where the request arrived.

That workflow hides two different failures:

- A relevant passage can be found even when the record is not sufficient to answer. The passage may be stale, pending, restricted, overridden, scoped to another requester, or only one part of a multi-source decision.
- When the record is not sufficient, the request is transferred without a durable case. Context and evidence disappear, ownership is unclear, and the employee is asked to explain the problem again.

The service snapshot estimates about 500 analyst hours per month across search, applicability checks, evidence validation, and routing. The median time to the first useful response is 19.3 hours. In an early retrieval pilot, 174 of 198 reviewed questions returned a plausible top-five passage, but reviewers considered only 102 ready to answer. Seven unsafe or unsupported answers still escaped. These are synthetic scenario measurements, not guaranteed business value.

## The wider operating pain

Admission makes the fragmentation visible. An upstream team opens a hiring request with entity, cost-center, subdivision, role, and contract data. Incorrect fields send the request back and forth before People Operations can begin. The candidate then enters personal data and uploads documents, but the source platform does not reliably prove that the fields match the files or that the expected document was supplied.

Analysts compare fields and files manually, repeat part of the registration in a globally controlled system, and track medical clearance, account setup, equipment, contract generation, and signatures in parallel. Some dependencies are chased through messaging. A request can be submitted without proving that the downstream action happened.

The client has asked whether analysts can operate from one working surface instead of reconstructing the same case across many places. That request is an operating outcome, not permission to pretend every system can be integrated. Several APIs and deployment choices still require approval from the parent organization, and some systems are unlikely to permit write access during a pilot. The packet includes one synthetic admission case snapshot so you can inspect requested state, confirmed state, dependencies, owners, and exceptions. It does not include validated end-to-end cases or agreed expected outcomes.

## What already exists

The client has an internal low-code email assistant with a permissioned queue, request classification, suggested editable replies, knowledge search, record storage, task creation, and a planned feedback control. Its operating metrics are not settled.

Any recommendation must explain why the proposed product should coexist with, extend, or replace that capability. Shipping another FAQ surface without resolving the overlap is a client failure even if its retrieval metrics look good.

## The business question

Can governed answers to employee questions actually cut manual work — without issuing unsupported or unsafe decisions, duplicating the internal assistant, or creating a new front door to the same queue?

The build target is fixed: a RAG decision service over the governed knowledge corpus, answering the employee questions People Operations receives today. That is deliberately a simple-sounding product. The test is whether it survives production: eligibility by entity, base, relationship, and date; approval states; conflicting and stale sources; restricted content; injected instructions; deferral that leaves a human an owned case; and a provider that can fail mid-request. A demo that retrieves plausible passages is a day of work. A system the client can put in front of employees is the assignment.

You still own the rollout judgment: how the product coexists with the internal assistant, what the pilot deliberately excludes — admission automation and write integrations stay out — and the conditions to expand or stop.

## Your assignment

### 1. Diagnose

Read every artifact in `case-data/client-discovery/`. Identify the material pain, who experiences it, why the current workflow fails, and what success should mean. Distinguish direct observations, reported state, delivery-team claims, and your own inference. Call out contradictions, assumptions, and the questions that could change your recommendation.

Do not assume that answer rate, automation rate, or saved hours is the goal. Decide which outcomes and failure costs matter.

### 2. Build

Build the required RAG-based decision system and a finished browser product in one container. It must satisfy [CONTRACT.md](./CONTRACT.md) and return one of three outcomes:

- an answer whose material claims resolve to exact eligible evidence;
- a human handoff with a durable identity, reason, owner, service level, preserved context, and a completion path;
- a conversational response when no policy decision is being requested.

The user-facing surface must let an operator ask, inspect, understand, and act. It should make supported evidence, deferral reason, case ownership, failure state, and diagnostic trace usable without exposing protected source text or personal data.

This is also a product-design requirement. The finished desk should have deliberate hierarchy, typography, spacing, interaction, responsive composition, and complete states. A technically connected form, raw JSON viewer, generic chat wrapper, or unstyled table is not a finished frontend. Choose your own visual direction, but make it coherent, accessible, and credible for daily operator use.

The contract fixes the interfaces and safety invariants needed for evaluation. It does not prescribe your retrieval stack, ranking method, model, thresholds, interface design, or rollout recommendation. The included decision desk is diagnostic starter code; leaving it materially unchanged is not a frontend submission.

### 3. Evaluate

Design a candidate-owned eval suite around the risks in your diagnosis. Use `evals/cases.json` and the supplied runner, and extend either when that makes your evidence stronger. Keep it runnable from a clean checkout.

Your evals should expose false answers, false deferrals, multi-source failures, stale or ineligible evidence, requester mismatch, source and prompt injection, privacy boundaries, paraphrase sensitivity, handoff quality, and at least one material risk you identified yourself. Include a counterfactual pair where the same question changes outcome when exactly one trusted profile or date axis changes. Keep honest failures in the suite; a complete run may finish with failed cases. Record the result, defects, and resulting decisions in `EVAL_REPORT.md`.

The hiring runner executes `node evals/run.ts` in bare Node 24 with the submission mounted read-only, no `node_modules`, and no public network. Candidate-owned evals do not replace sealed evaluation; they show how you would reason about quality before production feedback exists.

### 4. Present

Prepare a client readout that connects the diagnosis to the build and the eval evidence. Demonstrate one supported decision and a human handoff completed through the browser. Defend the pilot scope boundary: what it deliberately excludes and why. Draw the ownership boundary with the existing internal assistant across intake, drafting, tasks, knowledge, and feedback. Show a baseline calculation, the pilot owner, an expand condition, and a stop condition. Explain one eval failure that changed the system or recommendation.

We are evaluating the quality of the recommendation and the system behind it, not whether every rough edge disappeared within the timebox.

## How the challenge ends

The same submitted commit is reviewed in three separate parts:

1. **Evals** — your candidate-owned suite and the sealed system and browser evaluation run against the submitted artifact.
2. **Client presentation** — you give the 15-minute readout and defend the diagnosis, product choice, evidence, failures, and recommendation.
3. **Live operator design check** — the reviewer uses the browser product directly while acting as a People Operations operator. You do not drive the interface during the first-use pass. The reviewer judges whether the product is clear, trustworthy, beautiful, responsive, and genuinely workable without a guided feature tour.

These parts are independent. Strong retrieval cannot compensate for an unusable desk, a polished interface cannot compensate for unsafe decisions, and a confident presentation cannot compensate for either.

## The supplied source estate

The normalized snapshot preserves the production-shaped envelope without carrying client content:

- 22 delivered files become 34 governed sources;
- one workbook becomes 13 FAQ sources containing 269 rows;
- the synthetic source text exceeds 600,000 characters without preserving production source lengths;
- the original mix includes PDF, DOCX, XLSX, and PPTX;
- three inputs required OCR review;
- policy, process, collective instrument, checklist, table, deck, and registry records coexist.

Every organization, identifier, fact, value, and sentence is synthetic. The mess is deliberate. A source can be present and still be pending, rejected, expired, outside scope, too sensitive to quote, or weaker than another source. Some questions require several sources. Some have no support in the snapshot. Source text and user text are untrusted input.

The case begins after extraction. Raw Office and PDF binaries are out of scope; normalized text retains format, extraction, and OCR metadata. The discovery packet describes the business and must not be cited as employee-facing answer evidence. Only records in `case-data/source-documents.json` may support answer claims.

The discovery packet includes checklists and process references for admission, but no labeled validation set. Do not silently treat the single workflow snapshot as ground truth or an answer key. State what additional cases and outcomes you would need before automating an admission decision.

## Runtime constraints

The evaluator builds the submitted container once and tests that exact artifact.

- Build within 10 minutes; ready within 180 seconds.
- Run as numeric user and group `65532:65532` with a read-only root filesystem.
- Use `/tmp` only for disposable scratch work. The evaluator mounts an owned persistent directory at `/state` and sets `RUNTIME_STATE_PATH=/state`; handoff state must survive removal and recreation of the container against that same directory.
- Do not declare Docker `VOLUME` paths.
- Stay within 2 vCPU, 4 GiB memory, and 256 processes.
- Expect all Linux capabilities dropped and `no-new-privileges` enabled.
- Handle warm concurrency of 3.
- Target `p95 <= 10s`, `p99 <= 20s`, and valid contract responses for at least 99% of well-formed requests.
- Expect no public internet egress.
- Treat the optional metered OpenAI-compatible proxy as slow, rate-limited, or absent.
- End provider failures in a valid, safe decision.
- Treat the candidate-visible corpus as read-only.

Use any retrieval, ranking, parsing, model, or deterministic technique that fits those limits. You do not need to train a model.

## What is not supplied

There is no answer key, expected citation list, category distribution, score threshold, benchmark result, prescribed architecture, or guaranteed integration. Organizer cases and gold labels are outside the candidate package.

Do not edit source records to make the task easier, hard-code observed questions, or defer every request. Those shortcuts are measured directly.

## Timebox

Sixteen implementation hours, taken within two calendar days: the submission is due 2 days after your confirmed start. Stop at the box and hand over the engagement as you would to the client and the next engineer.
