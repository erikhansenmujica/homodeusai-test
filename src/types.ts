export type SourceAudience = "employee" | "internal" | "restricted";
export type ApprovalStatus = "approved" | "pending" | "rejected";

export interface SourceEligibility {
  legalEntityIds: string[];
  baseIds: string[];
  roles: string[];
  relationships: string[];
}

export interface SourceDocument {
  sourceId: string;
  versionId: string;
  title: string;
  sourceType: string;
  domain: string;
  audience: SourceAudience;
  approval: ApprovalStatus;
  policySensitivity: "low" | "medium" | "high";
  authorityTier: number;
  effectiveFrom: string;
  effectiveTo?: string;
  supersedes?: string[];
  eligibility: SourceEligibility;
  content: string;
  contentSha256: string;
  relativePath: string;
  deliveryFileId: string;
  originalFormat: "PDF" | "DOCX" | "XLSX" | "PPTX";
  extractionMode: "ocr" | "digital_text" | "structured";
  ocrReviewed: boolean;
  expectedCharacters: number;
  faqCategory?: string;
  faqRows?: number;
}

export interface RequesterContext {
  subjectId: string;
  legalEntityId: string;
  baseId: string;
  relationship: string;
  role: string;
  domains: string[];
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DecideRequest {
  requestId: string;
  question: string;
  asOf: string;
  requester: RequesterContext;
  history?: HistoryTurn[];
}

export interface EvidenceRef {
  sourceId: string;
  versionId: string;
  startByte: number;
  endByte: number;
  quote: string;
  quoteSha256: string;
}

export interface Claim {
  id: string;
  text: string;
  evidence: EvidenceRef[];
}

export type HandoffReason =
  | "human_requested"
  | "low_confidence"
  | "conflicting_source"
  | "missing_source"
  | "profile_mismatch"
  | "sensitive_topic"
  | "validation_pending"
  | "policy_sensitive_source"
  | "provider_failure";

export interface Handoff {
  ticketId: string;
  reasonCode: HandoffReason;
  queue: string;
  slaHours: number;
  idempotencyKey: string;
}

export type HandoffStatus = "open" | "resolved";

export interface HandoffRecord extends Handoff {
  status: HandoffStatus;
  createdAt: string;
  updatedAt: string;
  traceId: string;
  request: {
    requestId: string;
    question: string;
    asOf: string;
    requester: RequesterContext;
    history: HistoryTurn[];
  };
  evidenceGaps: string[];
  nextAction: string;
  resolution?: {
    actorId: string;
    summary: string;
    resolvedAt: string;
  };
}

export type Decision =
  | {
      kind: "answer";
      answerabilityScore: number;
      body: string;
      claims: Claim[];
      traceId: string;
    }
  | {
      kind: "defer";
      answerabilityScore: number;
      userMessage: string;
      handoff: Handoff;
      traceId: string;
    }
  | {
      kind: "conversational";
      body: string;
      traceId: string;
    };

export interface TraceEvidence {
  sourceId: string;
  versionId: string;
  startByte: number;
  endByte: number;
  rank: number;
  stage: string;
  score?: number;
}

export interface DecisionTrace {
  traceId: string;
  requestId: string;
  createdAt: string;
  decisionKind: Decision["kind"];
  pipelineVersion: string;
  indexVersion: string;
  stages: Array<"retrieval" | "governance" | "decision">;
  governance: {
    candidateCount: number;
    eligibleCount: number;
    rejectedCount: number;
    eligibleSources: Array<{ sourceId: string; versionId: string }>;
    rejectionReasons: Record<string, number>;
  };
  route: {
    kind: Decision["kind"];
    reasonCode?: HandoffReason;
  };
  provider: {
    status: "not_used" | "ok" | "failed" | "degraded";
  };
  consideredEvidence: TraceEvidence[];
  notes: string[];
}
