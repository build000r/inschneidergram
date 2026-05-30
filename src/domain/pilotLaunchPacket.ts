export interface PilotLaunchPacket {
  generatedAt: string;
  product: {
    name: string;
    promise: string;
    buyer: string;
  };
  recommendedFirstPilotPath: "operator_managed_manual_delivery";
  requiredExternalInputs: string[];
  routeMap: Record<string, string>;
  creatorListContract: {
    strictProvenanceRequiredForLivePilot: boolean;
    requiredFields: string[];
    optionalFields: string[];
    exampleTarget: Record<string, unknown>;
  };
  senderOperationsContract: {
    credentialBoundary: string;
    publicInventoryFields: string[];
    privateOperationalInputs: string[];
    exampleSender: Record<string, unknown>;
  };
  launchAuthorizationTemplate: {
    actor: string;
    deliveryPath: "manual";
    approvedTargetLimit: number;
    approvedAt: string;
    reference: string;
    evidenceUrl: string;
    notes: string;
  };
  deliveryPathOptions: Array<{
    kind: "manual" | "managed_provider";
    whenToUse: string;
    requiredBeforeExecution: string[];
    liveEvidenceSource: string;
  }>;
  proofContract: {
    proofPackUrl: string;
    handoffUrl: string;
    followUpsUrl: string;
    requiredMetrics: string[];
  };
  nextApiActions: Array<{
    id: string;
    method: string;
    path: string;
    state: "operator_required" | "graphed_required" | "available_after_campaign";
    purpose: string;
  }>;
  sampleCampaignRequest: Record<string, unknown>;
  validationCommands: string[];
  stopConditions: string[];
  nonGoals: string[];
}

export function buildPilotLaunchPacket(now = new Date()): PilotLaunchPacket {
  return {
    generatedAt: now.toISOString(),
    product: {
      name: "Inschneidergram",
      promise:
        "API-first Instagram creator outreach control plane with managed delivery proof.",
      buyer: "Graphed growth-agent operator"
    },
    recommendedFirstPilotPath: "operator_managed_manual_delivery",
    requiredExternalInputs: [
      "vetted Instagram creator list with source and fit rationale",
      "approved first-touch message copy",
      "healthy managed sender account operated outside this repo",
      "Graphed or client launch authorization for the selected delivery path",
      "callback endpoint for delivery/reply status when Graphed wants webhooks",
      "operator evidence for manual sent, failed, restricted, or replied outcomes"
    ],
    routeMap: {
      health: "/health",
      openApi: "/openapi.json",
      senderInventory: "/senders",
      senderHealth: "/senders/health",
      createCampaign: "/campaigns",
      campaignReadiness: "/campaigns/{campaignId}/readiness",
      campaignHandoff: "/campaigns/{campaignId}/pilot-handoff",
      operatorDashboard: "/operator/dashboard",
      executeCampaign: "/campaigns/{campaignId}/executions",
      operatorManualQueue: "/operator/manual-queue",
      manualEvidence: "/campaigns/{campaignId}/executions/{executionId}/manual-events",
      proofPack: "/campaigns/{campaignId}/proof-pack",
      followUps: "/campaigns/{campaignId}/follow-ups",
      webhookDeadLetters: "/webhooks/dead-letters"
    },
    creatorListContract: {
      strictProvenanceRequiredForLivePilot: true,
      requiredFields: ["target", "source", "fitReason"],
      optionalFields: [
        "profileUrl",
        "displayName",
        "tags",
        "followerCount",
        "engagementRate"
      ],
      exampleTarget: {
        target: "instagram_profile_1",
        profileUrl: "https://instagram.com/instagram_profile_1",
        source: "graphed-sheet:row-12",
        fitReason: "Audience overlaps the affiliate offer",
        tags: ["fitness", "affiliate"]
      }
    },
    senderOperationsContract: {
      credentialBoundary:
        "Sender credentials, recovery secrets, proxies, and session material stay outside this API and outside git.",
      publicInventoryFields: [
        "id",
        "status",
        "dailyLimit",
        "cooldownUntil",
        "warmupNote",
        "riskEvents"
      ],
      privateOperationalInputs: [
        "account credential or provider access",
        "session recovery owner",
        "restriction and complaint monitoring",
        "manual operator who can capture evidence"
      ],
      exampleSender: {
        id: "sender-a",
        status: "healthy",
        dailyLimit: 20,
        warmupNote: "low-volume pilot sender; private credentials held by operator"
      }
    },
    launchAuthorizationTemplate: {
      actor: "Graphed or client approver",
      deliveryPath: "manual",
      approvedTargetLimit: 10,
      approvedAt: now.toISOString(),
      reference: "approval ticket, signed note, or operator launch log",
      evidenceUrl: "private proof pointer or ticket URL",
      notes: "Approves sender, creator list, message copy, volume, and stop conditions."
    },
    deliveryPathOptions: [
      {
        kind: "manual",
        whenToUse:
          "First Graphed pilot: a product operator performs or verifies the low-volume Instagram action and records evidence.",
        requiredBeforeExecution: [
          "stored healthy sender inventory",
          "approved creators and copy",
          "launchAuthorization.deliveryPath=manual"
        ],
        liveEvidenceSource:
          "operator-submitted sent, failed, restricted, or replied evidence through manual-events"
      },
      {
        kind: "managed_provider",
        whenToUse:
          "Expansion path when a provider/account owner can report one outcome per approved target.",
        requiredBeforeExecution: [
          "provider-reported outcomes for every approved executable target",
          "account risk owner and incident process",
          "launchAuthorization.deliveryPath=managed_provider"
        ],
        liveEvidenceSource:
          "provider-reported sent, failed, restricted, or replied events in the execution request"
      }
    ],
    proofContract: {
      proofPackUrl: "/campaigns/{campaignId}/proof-pack",
      handoffUrl: "/campaigns/{campaignId}/pilot-handoff",
      followUpsUrl: "/campaigns/{campaignId}/follow-ups",
      requiredMetrics: [
        "sourcedTargets",
        "acceptedTargets",
        "vettedTargets",
        "approvedTargets",
        "contactedTargets",
        "sentMessages",
        "deliveredMessages",
        "replies",
        "interestedReplies",
        "duplicateSkips",
        "operatorSkippedTargets",
        "operatorBlockedTargets",
        "optOuts",
        "complaints",
        "deliveryFailures",
        "senderWarnings",
        "webhookDelivered",
        "webhookDeadLetters"
      ]
    },
    nextApiActions: [
      {
        id: "register_sender",
        method: "PUT",
        path: "/senders/{senderId}",
        state: "operator_required",
        purpose: "Register non-secret sender inventory and current risk state."
      },
      {
        id: "create_campaign",
        method: "POST",
        path: "/campaigns",
        state: "graphed_required",
        purpose: "Submit vetted creator targets, message copy, limits, and webhook URL."
      },
      {
        id: "approve_campaign",
        method: "POST",
        path: "/campaigns/{campaignId}/approval-workbench",
        state: "available_after_campaign",
        purpose: "Persist creator and first-touch copy approval before execution."
      },
      {
        id: "check_handoff",
        method: "GET",
        path: "/campaigns/{campaignId}/pilot-handoff",
        state: "available_after_campaign",
        purpose: "Inspect campaign-specific missing inputs and next actions."
      },
      {
        id: "check_operator_dashboard",
        method: "GET",
        path: "/operator/dashboard",
        state: "available_after_campaign",
        purpose: "Review cross-campaign readiness, manual work, sender health, dead letters, and proof status."
      },
      {
        id: "execute_or_queue",
        method: "POST",
        path: "/campaigns/{campaignId}/executions",
        state: "available_after_campaign",
        purpose: "Create manual queue or provider proof after readiness and launch authorization pass."
      },
      {
        id: "publish_proof",
        method: "GET",
        path: "/campaigns/{campaignId}/proof-pack",
        state: "available_after_campaign",
        purpose: "Review buyer-facing pilot metrics and renewal recommendation."
      }
    ],
    sampleCampaignRequest: {
      targets: [
        {
          target: "instagram_profile_1",
          source: "graphed-sheet:row-12",
          fitReason: "Audience overlaps the affiliate offer",
          tags: ["fitness", "affiliate"]
        }
      ],
      message: "Hey - loved your content. Would you be open to an affiliate partnership?",
      campaign: "client_creator_outreach_may_2026",
      settings: {
        senderPool: ["sender-a"],
        dailyLimitPerSender: 20,
        minDelaySeconds: 90,
        maxDelaySeconds: 420,
        requireTargetProvenance: true,
        webhookUrl: "https://hooks.graphed.com/inschneidergram/events"
      }
    },
    validationCommands: [
      "npm test",
      "npm run typecheck",
      "npm run build",
      "npm run smoke:service",
      "npm run demo:manual-pilot"
    ],
    stopConditions: [
      "sender warning or restriction",
      "complaint or opt-out",
      "duplicate send attempt",
      "missing creator or copy approval",
      "missing launch authorization",
      "missing operator evidence",
      "webhook dead-letter that cannot be replayed before proof publication"
    ],
    nonGoals: [
      "mock delivery is not represented as live Instagram proof",
      "the API does not store sender credentials",
      "the adapter contract does not claim official cold-DM compliance",
      "Graphed is not asked to host browser automation"
    ]
  };
}
