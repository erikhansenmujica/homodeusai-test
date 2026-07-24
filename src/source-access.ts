import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSourceDocuments } from "./corpus.ts";
import { activeSupersededSources, evaluateEligibility } from "./governance.ts";
import type { DecideRequest, SourceDocument } from "./types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface TrustedProfile {
  profileId: string;
  legalEntityId: string;
  baseId: string;
  relationship: string;
  role: string;
  audiences?: string[];
}

export interface SourceAccessContext {
  profileId?: string;
  legalEntityId?: string;
  baseId?: string;
  relationship?: string;
  role?: string;
  asOf: string;
}

export interface SafeSourceMetadata {
  sourceId: string;
  versionId: string;
  title: string;
  sourceType: string;
  domain: string;
  audience: SourceDocument["audience"];
  approval: SourceDocument["approval"];
  policySensitivity: SourceDocument["policySensitivity"];
  authorityTier: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  eligibility: SourceDocument["eligibility"];
  deliveryFileId: string;
  originalFormat: SourceDocument["originalFormat"];
  extractionMode: SourceDocument["extractionMode"];
  ocrReviewed: boolean;
  faqCategory: string | null;
  faqRows: number | null;
  contentBytes: number;
}

export type GovernedSourceResult =
  | {
      access: "available";
      message: string;
      metadata: SafeSourceMetadata;
      content: string;
    }
  | {
      access: "restricted";
      message: string;
      metadata: SafeSourceMetadata;
      restrictionReasons: string[];
    };

let trustedProfiles: TrustedProfile[] | null = null;

function loadTrustedProfiles(): TrustedProfile[] {
  if (trustedProfiles) return trustedProfiles;
  const payload = JSON.parse(
    readFileSync(join(ROOT, "case-data", "actors", "profiles.json"), "utf8"),
  ) as { profiles?: TrustedProfile[] };
  trustedProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  return trustedProfiles;
}

function profileMatchesContext(profile: TrustedProfile, context: SourceAccessContext): boolean {
  return (
    profile.legalEntityId === context.legalEntityId
    && profile.baseId === context.baseId
    && profile.relationship === context.relationship
    && profile.role === context.role
  );
}

export function resolveSourceProfile(context: SourceAccessContext): TrustedProfile | undefined {
  const profiles = loadTrustedProfiles();
  const byId = context.profileId
    ? profiles.find((profile) => profile.profileId === context.profileId)
    : undefined;
  if (byId) return byId;
  return profiles.find((profile) => profileMatchesContext(profile, context));
}

export function safeSourceMetadata(document: SourceDocument): SafeSourceMetadata {
  return {
    sourceId: document.sourceId,
    versionId: document.versionId,
    title: document.title,
    sourceType: document.sourceType,
    domain: document.domain,
    audience: document.audience,
    approval: document.approval,
    policySensitivity: document.policySensitivity,
    authorityTier: document.authorityTier,
    effectiveFrom: document.effectiveFrom,
    effectiveTo: document.effectiveTo ?? null,
    eligibility: document.eligibility,
    deliveryFileId: document.deliveryFileId,
    originalFormat: document.originalFormat,
    extractionMode: document.extractionMode,
    ocrReviewed: document.ocrReviewed,
    faqCategory: document.faqCategory ?? null,
    faqRows: document.faqRows ?? null,
    contentBytes: Buffer.byteLength(document.content, "utf8"),
  };
}

export function getGovernedSource(
  sourceId: string,
  versionId: string,
  context: SourceAccessContext,
): GovernedSourceResult | undefined {
  const documents = loadSourceDocuments();
  const document = documents.find(
    (candidate) => candidate.sourceId === sourceId && candidate.versionId === versionId,
  );
  if (!document) return undefined;

  const profile = resolveSourceProfile(context);
  if (!profile || Number.isNaN(Date.parse(context.asOf))) {
    return {
      access: "restricted",
      message: "Conteúdo não disponível nesta sessão.",
      metadata: safeSourceMetadata(document),
      restrictionReasons: ["trusted_context"],
    };
  }

  const request: DecideRequest = {
    requestId: "governed-source-view",
    question: "",
    asOf: context.asOf,
    requester: {
      subjectId: `source-viewer-${profile.profileId}`,
      legalEntityId: profile.legalEntityId,
      baseId: profile.baseId,
      relationship: profile.relationship,
      role: profile.role,
      domains: [],
    },
    history: [],
  };
  const superseded = activeSupersededSources(documents, request);
  const eligibility = evaluateEligibility(document, request, superseded);
  if (!eligibility.eligible) {
    return {
      access: "restricted",
      message: "Conteúdo não disponível nesta sessão.",
      metadata: safeSourceMetadata(document),
      restrictionReasons: [...new Set(eligibility.rejections.map((rejection) => rejection.code))],
    };
  }

  return {
    access: "available",
    message: "Documento governado disponível para este contexto confiável.",
    metadata: safeSourceMetadata(document),
    content: document.content,
  };
}

export function clearTrustedProfileCacheForTest(): void {
  trustedProfiles = null;
}
