# Stakeholder notes

All people and statements below are synthetic. The notes are intentionally incomplete and sometimes point in different directions.

## People Operations director

The queue is the visible problem, but a fast wrong answer is worse than waiting. The team needs fewer repetitive lookups and fewer requests bouncing between groups. A useful pilot must show where the product answered, why it stopped, and who owns the next action.

The director will not approve a broad rollout after a polished demo alone. She wants evidence from realistic cases, a failure review, and a recommendation for the first operating scope.

## People Operations analyst

Search is only part of the work. Analysts check the employee's legal entity, base, relationship, date, audience, and whether another source overrides what was found. Some requests need two documents. Some documents look authoritative but are pending or restricted.

Generic handoffs create more work. The employee replies, another analyst reopens the request, and the original context is lost.

## Employee service lead

Employees care about getting a usable next step. They do not care whether the system calls itself RAG. When the record is enough, the answer should be direct. When it is not, the employee should know what happens next without seeing internal policy or sensitive details.

The service lead worries that a high deferral rate will make the product feel like a new front door to the same queue.

## Service operations manager

The operating target for the quarter is to reduce analyst touches, not to improve search relevance. The manager wants the first release to cover the highest-volume requests and believes a broad human-review rule would miss the point of the investment.

She is willing to accept a narrower source scope if it moves quickly. The privacy lead does not agree that volume should decide the first scope.

## Privacy and risk lead

Restricted documents and personal records may be present in the environment. Their presence does not make them answerable. Diagnostic traces must help an operator investigate without copying source text, secrets, or personal data into logs.

The risk lead expects zero unsupported answers in the pilot. She also expects the team to test prompt injection, source injection, stale policy, conflicting policy, and requester mismatch.

## Platform lead

The evaluator and eventual production environment may not have public internet access. A model gateway can be available, slow, rate-limited, or absent. The service still needs a valid safe outcome and enough diagnostics to recover.

The platform team can operate one container first. They need readiness, a short runbook, predictable resource use, and a way to rebuild the index.

## Finance partner

Finance has not supplied loaded labor cost, error cost, backlog growth, or a pilot budget. The partner will not accept saved analyst hours as realized value without an operating plan that explains what the team will do with the capacity.

A cheaper search-only upgrade remains on the table. Finance wants the recommendation to say what evidence would distinguish that option from a decision product during a bounded pilot.

## Executive sponsor

The sponsor wants a recommendation, not a feature tour. Explain the client pain you chose to solve, show the evidence behind that choice, demonstrate the decision product, report what the evals found, and state what should happen next.
