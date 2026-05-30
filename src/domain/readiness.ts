import type { ApprovalWorkbench } from "./approval.js";
import { hasCreatorProfileProvenance, type Campaign } from "./campaign.js";
import { newestExecutionsFirst, type CampaignExecutionRecord } from "./store.js";

export type PilotReadinessStatus =
  | "blocked"
  | "needs_approval"
  | "ready_to_execute"
  | "awaiting_manual_evidence"
  | "evidence_ready";

export type PilotReadinessGateStatus = "pass" | "fail" | "warn";

export interface PilotReadinessGate {
  id: string;
  label: string;
  status: PilotReadinessGateStatus;
  detail: string;
  nextAction?: string;
}

export interface PilotReadinessReport {
  campaignId: string;
  campaignName: string;
  status: PilotReadinessStatus;
  readyForExecution: boolean;
  readyForEvidenceReview: boolean;
  counts: {
    sourcedTargets: number;
    acceptedTargets: number;
    vettedTargets: number;
    availableSenders: number;
    approvedTargets: number;
    actionableApprovedTargets: number;
    approvedCopy: number;
    executions: number;
    pendingManualEvidence: number;
    contactedTargets: number;
    interestedReplies: number;
  };
  gates: PilotReadinessGate[];
  nextActions: string[];
  externalInputs: string[];
}

export function buildPilotReadinessReport(input: {
  campaign: Campaign;
  approvalWorkbench?: ApprovalWorkbench | null;
  executions?: CampaignExecutionRecord[];
}): PilotReadinessReport {
  const executions = newestExecutionsFirst(input.executions ?? []);
  const latestExecution = executions[0];
  const acceptedTargets =
    input.campaign.summary.total -
    input.campaign.summary.skippedDuplicate -
    input.campaign.summary.blockedPolicy;
  const vettedTargets = input.campaign.targets.filter((target) =>
    isAcceptedTarget(target) && hasCreatorProfileProvenance(target.profile)
  ).length;
  const approvedTargets = input.approvalWorkbench?.summary.candidates.approved ?? 0;
  const approvedCopy = input.approvalWorkbench?.summary.messages.approved ?? 0;
  const actionableApprovedTargets = countActionableApprovedTargets(input.approvalWorkbench);
  const pendingManualEvidence = latestExecution
    ? countPendingManualEvidence(latestExecution)
    : 0;
  const contactedTargets = latestExecution?.proofPack.metrics.contactedTargets ?? 0;
  const interestedReplies = latestExecution?.proofPack.metrics.interestedReplies ?? 0;

  const gates: PilotReadinessGate[] = [
    {
      id: "target_intake",
      label: "Creator target intake",
      status: acceptedTargets > 0 ? "pass" : "fail",
      detail: `${acceptedTargets} accepted target(s) from ${input.campaign.summary.total} sourced target(s).`,
      nextAction:
        acceptedTargets > 0
          ? undefined
          : "Submit at least one valid, non-duplicate Instagram creator target."
    },
    {
      id: "sender_health",
      label: "Sender health",
      status: input.campaign.senderHealth.available > 0 ? "pass" : "fail",
      detail: `${input.campaign.senderHealth.available}/${input.campaign.senderHealth.total} sender account(s) available.`,
      nextAction:
        input.campaign.senderHealth.available > 0
          ? undefined
          : "Provide a healthy sender account or managed provider before execution."
    },
    {
      id: "creator_vetting",
      label: "Creator profile vetting",
      status:
        !input.campaign.settings.requireTargetProvenance ||
        (acceptedTargets > 0 && vettedTargets >= acceptedTargets)
          ? "pass"
          : "fail",
      detail: input.campaign.settings.requireTargetProvenance
        ? `${vettedTargets}/${acceptedTargets} accepted target(s) include source and fit rationale.`
        : `${vettedTargets} target(s) include source and fit rationale; provenance is optional for this campaign.`,
      nextAction:
        input.campaign.settings.requireTargetProvenance &&
        !(acceptedTargets > 0 && vettedTargets >= acceptedTargets)
          ? "Attach source and fit rationale to every accepted creator target."
          : undefined
    },
    {
      id: "approval_workbench",
      label: "Approval workbench",
      status: input.approvalWorkbench ? "pass" : "fail",
      detail: input.approvalWorkbench
        ? "Approval workbench exists for creator and copy review."
        : "No approval workbench exists for this campaign.",
      nextAction: input.approvalWorkbench
        ? undefined
        : "Create an approval workbench and approve creator/copy decisions."
    },
    {
      id: "creator_approval",
      label: "Creator approval",
      status: actionableApprovedTargets > 0 ? "pass" : "fail",
      detail: `${actionableApprovedTargets} actionable approved creator(s) from ${approvedTargets} approved creator(s).`,
      nextAction:
        actionableApprovedTargets > 0
          ? undefined
          : "Approve at least one creator whose work state is queued or claimed."
    },
    {
      id: "copy_approval",
      label: "Copy approval",
      status: approvedCopy > 0 ? "pass" : "fail",
      detail: `${approvedCopy} approved first-touch message(s).`,
      nextAction:
        approvedCopy > 0 ? undefined : "Approve one first-touch message before execution."
    },
    {
      id: "execution_proof",
      label: "Execution proof",
      status: latestExecution ? "pass" : "warn",
      detail: latestExecution
        ? `Latest execution ${latestExecution.id} has ${contactedTargets} contacted target(s).`
        : "No execution proof record exists yet.",
      nextAction: latestExecution
        ? undefined
        : "Run a mock or manual-safe execution after approvals pass."
    },
    {
      id: "manual_evidence",
      label: "Manual evidence",
      status: pendingManualEvidence > 0 ? "warn" : "pass",
      detail:
        pendingManualEvidence > 0
          ? `${pendingManualEvidence} manual delivery attempt(s) still need evidence.`
          : "No pending manual evidence is required.",
      nextAction:
        pendingManualEvidence > 0
          ? "Record sent, failed, restricted, or replied evidence for every pending manual intent."
          : undefined
    }
  ];

  const failedGateIds = new Set(gates.filter((gate) => gate.status === "fail").map((gate) => gate.id));
  const readyForExecution =
    !failedGateIds.has("target_intake") &&
    !failedGateIds.has("sender_health") &&
    !failedGateIds.has("creator_vetting") &&
    !failedGateIds.has("approval_workbench") &&
    !failedGateIds.has("creator_approval") &&
    !failedGateIds.has("copy_approval");
  const readyForEvidenceReview = !!latestExecution && pendingManualEvidence === 0;
  const status = classifyReadiness({
    failedGateIds,
    readyForExecution,
    latestExecution,
    pendingManualEvidence,
    contactedTargets,
    interestedReplies
  });
  const nextActions = gates
    .filter((gate) => gate.status !== "pass" && gate.nextAction)
    .map((gate) => gate.nextAction as string);
  const externalInputs = externalInputsForGates(gates, latestExecution);

  return {
    campaignId: input.campaign.id,
    campaignName: input.campaign.campaign,
    status,
    readyForExecution,
    readyForEvidenceReview,
    counts: {
      sourcedTargets: input.campaign.summary.total,
      acceptedTargets,
      vettedTargets,
      availableSenders: input.campaign.senderHealth.available,
      approvedTargets,
      actionableApprovedTargets,
      approvedCopy,
      executions: executions.length,
      pendingManualEvidence,
      contactedTargets,
      interestedReplies
    },
    gates,
    nextActions,
    externalInputs
  };
}

function classifyReadiness(input: {
  failedGateIds: Set<string>;
  readyForExecution: boolean;
  latestExecution: CampaignExecutionRecord | undefined;
  pendingManualEvidence: number;
  contactedTargets: number;
  interestedReplies: number;
}): PilotReadinessStatus {
  if (
    input.failedGateIds.has("target_intake") ||
    input.failedGateIds.has("sender_health") ||
    input.failedGateIds.has("creator_vetting")
  ) {
    return "blocked";
  }
  if (!input.readyForExecution) {
    return "needs_approval";
  }
  if (input.pendingManualEvidence > 0) {
    return "awaiting_manual_evidence";
  }
  if (input.latestExecution && (input.contactedTargets > 0 || input.interestedReplies > 0)) {
    return "evidence_ready";
  }

  return "ready_to_execute";
}

function countActionableApprovedTargets(workbench: ApprovalWorkbench | null | undefined): number {
  if (!workbench) {
    return 0;
  }

  return workbench.candidates.filter(
    (candidate) =>
      candidate.approval === "approved" &&
      (candidate.work === "queued" || candidate.work === "claimed")
  ).length;
}

function countPendingManualEvidence(execution: CampaignExecutionRecord): number {
  if (execution.adapterRiskPosture?.kind !== "manual") {
    return 0;
  }

  return execution.deliveryAttempts.filter((attempt) => attempt.events.length === 0).length;
}

function externalInputsForGates(
  gates: PilotReadinessGate[],
  latestExecution: CampaignExecutionRecord | undefined
): string[] {
  const inputs = new Set<string>();

  for (const gate of gates) {
    if (gate.status === "pass") {
      continue;
    }
    if (gate.id === "target_intake") {
      inputs.add("vetted Instagram creator list");
    }
    if (gate.id === "sender_health") {
      inputs.add("healthy sender account or managed provider");
    }
    if (gate.id === "creator_vetting") {
      inputs.add("creator provenance and fit rationale");
    }
    if (gate.id === "approval_workbench" || gate.id === "creator_approval") {
      inputs.add("creator approval decision");
    }
    if (gate.id === "copy_approval") {
      inputs.add("approved first-touch copy");
    }
    if (gate.id === "manual_evidence") {
      inputs.add("operator delivery evidence");
    }
  }

  if (!latestExecution) {
    inputs.add("permission to run the selected pilot delivery path");
  }

  return [...inputs];
}

function isAcceptedTarget(target: Campaign["targets"][number]): boolean {
  return target.status !== "skipped_duplicate" && target.status !== "blocked_policy";
}
