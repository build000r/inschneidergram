import { z } from "zod";
import { normalizeInstagramHandle } from "./handles.js";

export type ApprovalState = "pending" | "approved" | "rejected";
export type CandidateWorkState = "queued" | "claimed" | "sent" | "skipped" | "blocked";
export type EvidenceKind = "send" | "skip" | "block";
export type AuditAction =
  | "workbench_created"
  | "candidate_approved"
  | "candidate_rejected"
  | "message_approved"
  | "message_rejected"
  | "candidate_claimed"
  | "send_recorded"
  | "candidate_skipped"
  | "candidate_blocked";

export interface ApprovalEvidence {
  kind: EvidenceKind;
  at: string;
  actor: string;
  messageId?: string;
  providerMessageId?: string;
  source?: string;
  reference?: string;
  note?: string;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: AuditAction;
  entityType: "workbench" | "candidate" | "message";
  entityId: string;
  reason?: string;
  evidence?: ApprovalEvidence;
}

export interface CreatorCandidate {
  id: string;
  raw: string;
  handle: string;
  approval: ApprovalState;
  work: CandidateWorkState;
  claimedBy?: string;
  claimedAt?: string;
  reason?: string;
  evidence: ApprovalEvidence[];
}

export interface MessageCopy {
  id: string;
  body: string;
  approval: ApprovalState;
  reason?: string;
}

export interface ApprovalWorkbench {
  id: string;
  campaignId: string;
  createdAt: string;
  updatedAt: string;
  candidates: CreatorCandidate[];
  messages: MessageCopy[];
  audit: AuditEntry[];
  summary: ApprovalSummary;
}

export interface ApprovalSummary {
  candidates: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    claimed: number;
    sent: number;
    skipped: number;
    blocked: number;
  };
  messages: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
}

const actorSchema = z.string().min(1).max(120);
const reasonSchema = z.string().min(1).max(1000).optional();

const candidateInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  target: z.string().min(1),
  reason: reasonSchema
});

const messageInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(1000),
  reason: reasonSchema
});

const createWorkbenchSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  campaignId: z.string().min(1).max(120),
  candidates: z.array(candidateInputSchema).min(1).max(5000),
  messages: z.array(messageInputSchema).min(1).max(25)
});

const candidateDecisionSchema = z.object({
  candidateId: z.string().min(1),
  actor: actorSchema,
  reason: reasonSchema
});

const messageDecisionSchema = z.object({
  messageId: z.string().min(1),
  actor: actorSchema,
  reason: reasonSchema
});

const claimSchema = z.object({
  candidateId: z.string().min(1),
  operator: actorSchema
});

const evidenceSchema = z.object({
  source: z.string().min(1).max(120).optional(),
  reference: z.string().min(1).max(500).optional(),
  note: z.string().min(1).max(1000).optional()
});

const sendEvidenceSchema = z.object({
  candidateId: z.string().min(1),
  messageId: z.string().min(1),
  operator: actorSchema,
  providerMessageId: z.string().min(1).max(200).optional(),
  evidence: evidenceSchema.default({})
});

const terminalEvidenceSchema = z.object({
  candidateId: z.string().min(1),
  operator: actorSchema,
  reason: z.string().min(1).max(1000),
  evidence: evidenceSchema.default({})
});

export function createApprovalWorkbench(
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  const parsed = createWorkbenchSchema.parse(input);
  const nowIso = now.toISOString();
  const candidates = parsed.candidates.map((candidate, index) => ({
    id: candidate.id ?? `cand_${index + 1}`,
    raw: candidate.target,
    handle: normalizeInstagramHandle(candidate.target),
    approval: "pending" as const,
    work: "queued" as const,
    reason: candidate.reason,
    evidence: []
  }));
  const messages = parsed.messages.map((message, index) => ({
    id: message.id ?? `msgcopy_${index + 1}`,
    body: message.body,
    approval: "pending" as const,
    reason: message.reason
  }));

  assertUnique(candidates.map((candidate) => candidate.id), "candidate id");
  assertUnique(candidates.map((candidate) => candidate.handle), "candidate handle");
  assertUnique(messages.map((message) => message.id), "message id");

  return summarize({
    id: parsed.id ?? `approval_${parsed.campaignId}`,
    campaignId: parsed.campaignId,
    createdAt: nowIso,
    updatedAt: nowIso,
    candidates,
    messages,
    audit: [
      {
        at: nowIso,
        actor: "system",
        action: "workbench_created",
        entityType: "workbench",
        entityId: parsed.id ?? `approval_${parsed.campaignId}`
      }
    ],
    summary: emptySummary()
  });
}

export function approveCandidate(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  const decision = candidateDecisionSchema.parse(input);
  const next = cloneWorkbench(workbench);
  const candidate = findCandidate(next, decision.candidateId);

  assertCandidateIsNotTerminal(candidate);
  if (candidate.approval !== "pending") {
    throw new Error(`Candidate ${candidate.id} is already ${candidate.approval}`);
  }

  candidate.approval = "approved";
  candidate.reason = decision.reason;
  return appendAudit(next, now, {
    actor: decision.actor,
    action: "candidate_approved",
    entityType: "candidate",
    entityId: candidate.id,
    reason: decision.reason
  });
}

export function rejectCandidate(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  const decision = candidateDecisionSchema.parse(input);
  const next = cloneWorkbench(workbench);
  const candidate = findCandidate(next, decision.candidateId);

  if (candidate.work === "sent") {
    throw new Error(`Candidate ${candidate.id} was already sent`);
  }
  candidate.approval = "rejected";
  candidate.work = "blocked";
  candidate.claimedBy = undefined;
  candidate.claimedAt = undefined;
  candidate.reason = decision.reason;
  return appendAudit(next, now, {
    actor: decision.actor,
    action: "candidate_rejected",
    entityType: "candidate",
    entityId: candidate.id,
    reason: decision.reason
  });
}

export function approveMessage(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  const decision = messageDecisionSchema.parse(input);
  const next = cloneWorkbench(workbench);
  const message = findMessage(next, decision.messageId);

  if (message.approval !== "pending") {
    throw new Error(`Message ${message.id} is already ${message.approval}`);
  }
  message.approval = "approved";
  message.reason = decision.reason;
  return appendAudit(next, now, {
    actor: decision.actor,
    action: "message_approved",
    entityType: "message",
    entityId: message.id,
    reason: decision.reason
  });
}

export function rejectMessage(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  const decision = messageDecisionSchema.parse(input);
  const next = cloneWorkbench(workbench);
  const message = findMessage(next, decision.messageId);

  if (messageWasSent(next, message.id)) {
    throw new Error(`Message ${message.id} was already used for a sent candidate`);
  }
  message.approval = "rejected";
  message.reason = decision.reason;
  return appendAudit(next, now, {
    actor: decision.actor,
    action: "message_rejected",
    entityType: "message",
    entityId: message.id,
    reason: decision.reason
  });
}

export function claimCandidate(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  const claim = claimSchema.parse(input);
  const next = cloneWorkbench(workbench);
  const candidate = findCandidate(next, claim.candidateId);

  requireCandidateApproval(candidate);
  if (candidate.work !== "queued") {
    throw new Error(`Candidate ${candidate.id} is not claimable from ${candidate.work}`);
  }

  candidate.work = "claimed";
  candidate.claimedBy = claim.operator;
  candidate.claimedAt = now.toISOString();
  return appendAudit(next, now, {
    actor: claim.operator,
    action: "candidate_claimed",
    entityType: "candidate",
    entityId: candidate.id
  });
}

export function recordSendEvidence(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  const sent = sendEvidenceSchema.parse(input);
  const next = cloneWorkbench(workbench);
  const candidate = findCandidate(next, sent.candidateId);
  const message = findMessage(next, sent.messageId);

  requireClaimOwner(candidate, sent.operator);
  requireMessageApproval(message);

  const evidence = buildEvidence("send", sent.operator, now, {
    ...sent.evidence,
    messageId: message.id,
    providerMessageId: sent.providerMessageId
  });
  candidate.work = "sent";
  candidate.evidence.push(evidence);
  return appendAudit(next, now, {
    actor: sent.operator,
    action: "send_recorded",
    entityType: "candidate",
    entityId: candidate.id,
    evidence
  });
}

export function skipCandidate(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  return recordTerminalEvidence(workbench, input, now, "skip", "candidate_skipped", "skipped");
}

export function blockCandidate(
  workbench: ApprovalWorkbench,
  input: unknown,
  now = new Date()
): ApprovalWorkbench {
  return recordTerminalEvidence(workbench, input, now, "block", "candidate_blocked", "blocked");
}

function recordTerminalEvidence(
  workbench: ApprovalWorkbench,
  input: unknown,
  now: Date,
  kind: EvidenceKind,
  action: AuditAction,
  work: CandidateWorkState
): ApprovalWorkbench {
  const terminal = terminalEvidenceSchema.parse(input);
  const next = cloneWorkbench(workbench);
  const candidate = findCandidate(next, terminal.candidateId);

  requireClaimOwner(candidate, terminal.operator);

  const evidence = buildEvidence(kind, terminal.operator, now, terminal.evidence);
  candidate.work = work;
  candidate.reason = terminal.reason;
  candidate.evidence.push(evidence);
  return appendAudit(next, now, {
    actor: terminal.operator,
    action,
    entityType: "candidate",
    entityId: candidate.id,
    reason: terminal.reason,
    evidence
  });
}

function appendAudit(
  workbench: ApprovalWorkbench,
  now: Date,
  entry: Omit<AuditEntry, "at">
): ApprovalWorkbench {
  workbench.updatedAt = now.toISOString();
  workbench.audit.push({ ...entry, at: now.toISOString() });
  return summarize(workbench);
}

function buildEvidence(
  kind: EvidenceKind,
  actor: string,
  now: Date,
  details: Omit<ApprovalEvidence, "kind" | "actor" | "at">
): ApprovalEvidence {
  return {
    kind,
    at: now.toISOString(),
    actor,
    ...details
  };
}

function findCandidate(workbench: ApprovalWorkbench, candidateId: string): CreatorCandidate {
  const candidate = workbench.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }
  return candidate;
}

function findMessage(workbench: ApprovalWorkbench, messageId: string): MessageCopy {
  const message = workbench.messages.find((entry) => entry.id === messageId);
  if (!message) {
    throw new Error(`Message not found: ${messageId}`);
  }
  return message;
}

function requireCandidateApproval(candidate: CreatorCandidate): void {
  if (candidate.approval !== "approved") {
    throw new Error(`Candidate ${candidate.id} must be approved before operator work`);
  }
}

function requireMessageApproval(message: MessageCopy): void {
  if (message.approval !== "approved") {
    throw new Error(`Message ${message.id} must be approved before send`);
  }
}

function requireClaimOwner(candidate: CreatorCandidate, operator: string): void {
  requireCandidateApproval(candidate);
  if (candidate.work !== "claimed") {
    throw new Error(`Candidate ${candidate.id} must be claimed before evidence is recorded`);
  }
  if (candidate.claimedBy !== operator) {
    throw new Error(`Candidate ${candidate.id} is claimed by ${candidate.claimedBy}`);
  }
}

function assertCandidateIsNotTerminal(candidate: CreatorCandidate): void {
  if (candidate.work === "sent" || candidate.work === "skipped" || candidate.work === "blocked") {
    throw new Error(`Candidate ${candidate.id} already has terminal work state ${candidate.work}`);
  }
}

function messageWasSent(workbench: ApprovalWorkbench, messageId: string): boolean {
  return workbench.candidates.some((candidate) =>
    candidate.evidence.some(
      (evidence) => evidence.kind === "send" && evidence.messageId === messageId
    )
  );
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function cloneWorkbench(workbench: ApprovalWorkbench): ApprovalWorkbench {
  return {
    ...workbench,
    candidates: workbench.candidates.map((candidate) => ({
      ...candidate,
      evidence: candidate.evidence.map((evidence) => ({ ...evidence }))
    })),
    messages: workbench.messages.map((message) => ({ ...message })),
    audit: workbench.audit.map((entry) => ({
      ...entry,
      evidence: entry.evidence ? { ...entry.evidence } : undefined
    })),
    summary: {
      candidates: { ...workbench.summary.candidates },
      messages: { ...workbench.summary.messages }
    }
  };
}

function summarize(workbench: ApprovalWorkbench): ApprovalWorkbench {
  const summary = emptySummary();
  summary.candidates.total = workbench.candidates.length;
  summary.messages.total = workbench.messages.length;

  for (const candidate of workbench.candidates) {
    summary.candidates[candidate.approval] += 1;
    if (candidate.work === "claimed") {
      summary.candidates.claimed += 1;
    }
    if (candidate.work === "sent") {
      summary.candidates.sent += 1;
    }
    if (candidate.work === "skipped") {
      summary.candidates.skipped += 1;
    }
    if (candidate.work === "blocked") {
      summary.candidates.blocked += 1;
    }
  }

  for (const message of workbench.messages) {
    summary.messages[message.approval] += 1;
  }

  workbench.summary = summary;
  return workbench;
}

function emptySummary(): ApprovalSummary {
  return {
    candidates: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      claimed: 0,
      sent: 0,
      skipped: 0,
      blocked: 0
    },
    messages: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0
    }
  };
}
