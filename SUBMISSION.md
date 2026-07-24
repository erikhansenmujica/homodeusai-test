# Submission

Stop after 16 implementation hours. Submit the state you would put in front of the client and hand to the next engineer, including the rough edges you chose not to hide.

## Required deliverables

1. The working source tree and `Dockerfile`.
2. The finished decision desk at `/`, with the starter markers removed.
3. `CLIENT_READOUT.md`, structured as no more than 10 top-level Markdown sections. Cover the diagnosis, evidence and assumptions, pilot scope boundary and what it deliberately excludes, ownership boundary with the existing internal assistant, baseline calculation, demo path, eval findings, pilot owner, limits, and stop/expand conditions.
4. `EVAL_REPORT.md`, covering exact run totals, suite design, failed cases, false answers, false deferrals, threshold choices, counterfactual boundaries, handoff lifecycle evidence, provider-unavailable behavior, defects found, the candidate-defined risk you chose and why, and the next cases you would add.
5. A runnable candidate suite under `evals/` with at least 12 non-sample cases.
6. `ARCHITECTURE.md`, no more than 1,200 words, covering the main choices, rejected alternatives, trusted-session assumptions, production authorization and tenant isolation, and failure modes that still worry you.
7. `RUNBOOK.md` with build, start, readiness, test, index recovery, provider outage, and handoff incident steps.
8. Automated tests for the risks you consider highest.
9. One desktop screenshot and one mobile screenshot of a real decision from your implementation.

Do not submit credentials, captured real-user traffic, organizer material, or generated indexes tied to an absolute machine path.

`npm run evals` must remain exactly `node evals/run.ts`. That runner executes in bare Node 24 without installed packages or public network access, so keep it limited to Node built-ins and local submission files.

Keep the submitted tree under 5,000 regular files, 7,500 filesystem entries, 100 MiB total, 20 MiB per file, and 32 directory levels. Use regular files and directories only; symlinks and special files are rejected before the build.

## Delivery

Before you start, your private invitation must name all four submission details:

- the deadline date and time;
- the deadline timezone;
- the private channel or thread for submission; and
- the reviewer identity and repository account.

The 16-hour clock starts only after all four details are present. Work in a private repository created from the history-free kit. Before the stated deadline, grant the named reviewer account access and submit the private repository URL and exact commit SHA through the named private channel. That SHA is the evaluated submission.

If any detail is missing, reply to the original sender before starting. Do not guess or submit through a public channel. The 16-hour clock has not started, and no submission is valid until all four details are confirmed. If the named channel does not acknowledge receipt, reply in the same thread once with the URL and SHA. Do not send the organizer repository or add evaluator material to your repository.

## Build check

These commands must work from a clean checkout:

```bash
docker build -t nexo-atlantico-case .
docker volume create nexo-atlantico-case-state
docker run --detach --name nexo-atlantico-case-run -p 8080:8080 \
  --cpus 2 \
  --memory 4g \
  --pids-limit 256 \
  --user 65532:65532 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --mount type=volume,source=nexo-atlantico-case-state,target=/state \
  --env RUNTIME_STATE_PATH=/state \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  nexo-atlantico-case
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/readyz
curl -fsS http://localhost:8080/api/profiles
curl -fsS http://localhost:8080/api/corpus
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
docker rm --force --volumes nexo-atlantico-case-run
docker volume rm nexo-atlantico-case-state
```

The build has a 10-minute limit. The submitted image must not declare Docker `VOLUME` paths. Use `/tmp` for disposable work and `RUNTIME_STATE_PATH` for handoff state that must survive container recreation.

Then open `http://localhost:8080`, submit a request, inspect its decision and evidence, and load the trace. If you use the optional model proxy, document the three environment variables and show the safe behavior when the proxy disappears during a request.

The starter eval command is expected to fail because it includes only two sample cases. Your submission should replace that gap with a purposeful suite and a report of the real result.

## Final review: three parts

All three parts use the exact submitted commit. There is no rebuild or polish pass between them.

### 1. Evals

The organizer runs your candidate-owned suite, the sealed decision bank, the browser contract, provider-failure probes, and lifecycle checks. Private prompts, gold labels, accepted evidence, weights, and thresholds are not disclosed.

### 2. Client presentation

Give a 15-minute readout using `CLIENT_READOUT.md`, followed by questions. Spend the time as you would with a client sponsor and the operating team:

- state the pain and the evidence behind your diagnosis;
- show one supported decision and one human handoff completed through the browser;
- explain what your evals changed or exposed;
- explain why this product should coexist with, extend, or replace the internal assistant;
- recommend what should happen next and what must be true before rollout.

The readout should make sense without a tour of every file or function.

### 3. Live operator design check

After the presentation, the reviewer opens the same browser product and acts as a People Operations operator. The reviewer controls the mouse and keyboard, chooses the questions, inspects evidence, follows a deferral, and completes a human handoff. During the initial pass, observe without telling the reviewer where to click. You may explain your design choices after that pass.

This check judges the product as an interface, not as a screenshot. The reviewer looks for first-use clarity, visual hierarchy, coherent typography and spacing, trustworthy evidence presentation, usable handoff states, responsive behavior, accessibility, recovery from slow or failed requests, and purposeful interaction. A generic form, raw JSON view, unfinished starter, or interface that only works while you narrate it does not pass.

## Handoff note

In `ARCHITECTURE.md`, say where the 16 hours went. Be specific. A concrete tradeoff tells us more than a diagram with no decision behind it.

Before sending, confirm:

- the corpus files are unchanged;
- the page no longer declares itself an incomplete starter;
- answer, defer, conversational, error, empty, loading, and trace states are usable;
- exact citations still resolve after a clean build;
- repeated handoff requests reuse the same identity;
- candidate evals run and the report matches their result;
- the client readout separates observed facts from your assumptions;
- no private evaluator or answer material is present.
