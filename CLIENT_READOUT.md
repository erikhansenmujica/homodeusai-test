# Recommendation

Run a bounded internal pilot of the governed decision component behind the existing assistant—not as a second employee chatbot. Start with approved employee-facing questions where applicability can be derived from trusted entity, base, relationship, role, and date. Keep admission automation and write integrations out.

# Diagnosis: the operating problem

Observed: People Operations spends an estimated 503.2 analyst hours per month across search, applicability checks, evidence validation, and routing. Median first useful response is 19.3 hours. The early retrieval pilot found a plausible top-five passage for 174/198 questions, but only 102 were ready to answer and seven unsafe or unsupported answers escaped. Generic handoffs reopened at 31.4%.

The failure is not search alone. Analysts must decide whether evidence is approved, current, requester-applicable, non-restricted, non-conflicting, and complete. When it is not, context and ownership disappear during transfer.

# Evidence, tensions, and assumptions

Direct packet evidence supports fragmented channels, repeated applicability checks, ambiguous workflow states, restricted material, unavailable integrations, and overlap with an internal low-code assistant. Stakeholders disagree about volume-first automation versus zero unsupported answers.

Assumptions to validate: trusted requester context can be supplied at intake; knowledge owners can resolve conflicts within the stated SLA; pilot traffic can be sampled without copying protected content; and the existing assistant can call this service. The packet provides no demand mix, loaded labor cost, error cost, pilot budget, or labeled admission outcomes.

# Product and scope boundary

The build returns one of three terminal outcomes: an answer whose claims resolve to exact eligible bytes, a conversational response, or a durable human case with owner, reason, SLA, preserved context, and completion.

Pilot inclusions: employee-facing approved corpus, read-only decisions, trusted requester axes, evidence inspection, diagnostic traces, and human completion.

Deliberate exclusions: admission automation, live personal balances or status, payroll/termination amounts, clinical interpretation, write access, broad workflow orchestration, and autonomous use of internal/restricted sources.

# Boundary with the existing assistant

The internal assistant should continue to own intake, classification, editable reply workflow, record creation, tasks, and feedback capture. This service should own governed knowledge retrieval, applicability, conflict/coverage judgment, exact citations, and the structured deferral receipt. Integrate it as a decision tool in the existing flow. The submitted desk is the operator and pilot-validation surface, not a proposal for another public front door.

# Demonstration

Supported path: ask when the monthly proof becomes available; inspect the exact FAQ byte span, open its governance metadata, then open the redacted trace.

Handoff path: ask to speak with a person; open the durable ticket, verify the preserved request, gap, owner, SLA and next action, enter a completion summary, and confirm the resolved state.

# Evaluation evidence

The candidate run completed 19/19 cases: 10 answers, 8 deferrals, and 1 conversational case across six domains. It includes two multi-source answers, both deliberate source conflicts, privacy/injection, unsupported benefits, paraphrases, and a relationship-only answer/defer twin.

An early probe incorrectly borrowed meal support for an internet allowance. Adding concept coverage fixed it and created two permanent missing-evidence regressions. That failure is why exact lexical relevance—not merely a high passage score—is a rollout gate.

# Baseline and pilot measures

The current baseline is 2,659 monthly-equivalent requests and 503.2 analyst hours, or about **11.35 analyst minutes per request** across the measured work. This is not a savings claim.

For the pilot, measure unsupported answer rate, unnecessary deferral rate, analyst touches per eligible request, safe actionable handoff rate, reopen rate, first useful response, trace reconciliation, and operator completion. Finance should value only capacity tied to an agreed operating plan.

# Ownership and rollout decision

The People Operations director owns the pilot outcome; Knowledge Governance owns source conflicts and gaps; the service operations manager owns touch/reopen measurement; Privacy owns leakage review; Platform owns availability and state recovery.

Expand only after a representative adjudicated sample has zero unsupported answers, every trace reconciles, handoffs preserve context across restart, and eligible-scope analyst touches fall materially without a compensating rise in reopened work.

Stop immediately for any unsupported/restricted answer, personal-data or canary leakage, lost/duplicate handoff, unreconciled trace, or repeated operator inability to complete the core flow. Pause expansion if the product merely moves traffic to the same queue.
