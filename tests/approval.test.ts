import {
  approveCandidate,
  approveMessage,
  blockCandidate,
  claimCandidate,
  createApprovalWorkbench,
  recordSendEvidence,
  rejectCandidate,
  rejectMessage,
  skipCandidate
} from "../src/domain/approval.js";

describe("approval domain", () => {
  it("models creator and message approval through a sent evidence trail", () => {
    let workbench = createApprovalWorkbench(
      {
        id: "approval_pilot",
        campaignId: "camp_pilot",
        candidates: [
          { id: "creator_1", target: "@Creator.One", reason: "strong fit" },
          { id: "creator_2", target: "https://instagram.com/creator.two" }
        ],
        messages: [{ id: "copy_1", body: "Hey - open to an affiliate pilot?" }]
      },
      new Date("2026-05-30T00:00:00.000Z")
    );

    workbench = approveCandidate(
      workbench,
      { candidateId: "creator_1", actor: "approver", reason: "meets ICP" },
      new Date("2026-05-30T00:01:00.000Z")
    );
    workbench = approveMessage(
      workbench,
      { messageId: "copy_1", actor: "approver", reason: "brand safe" },
      new Date("2026-05-30T00:02:00.000Z")
    );
    workbench = claimCandidate(
      workbench,
      { candidateId: "creator_1", operator: "operator-a" },
      new Date("2026-05-30T00:03:00.000Z")
    );
    workbench = recordSendEvidence(
      workbench,
      {
        candidateId: "creator_1",
        messageId: "copy_1",
        operator: "operator-a",
        providerMessageId: "ig_msg_123",
        evidence: {
          source: "manual-workbench",
          reference: "screenshot://sent/creator_1",
          note: "DM visible as sent"
        }
      },
      new Date("2026-05-30T00:04:00.000Z")
    );

    expect(workbench.candidates[0]).toMatchObject({
      handle: "creator.one",
      approval: "approved",
      work: "sent",
      claimedBy: "operator-a"
    });
    expect(workbench.candidates[0]?.evidence).toEqual([
      expect.objectContaining({
        kind: "send",
        actor: "operator-a",
        messageId: "copy_1",
        providerMessageId: "ig_msg_123"
      })
    ]);
    expect(workbench.summary).toMatchObject({
      candidates: {
        total: 2,
        pending: 1,
        approved: 1,
        rejected: 0,
        claimed: 0,
        sent: 1
      },
      messages: {
        total: 1,
        pending: 0,
        approved: 1,
        rejected: 0
      }
    });
    expect(workbench.audit.map((entry) => entry.action)).toEqual([
      "workbench_created",
      "candidate_approved",
      "message_approved",
      "candidate_claimed",
      "send_recorded"
    ]);
  });

  it("guards sends behind creator approval, operator claim, and message approval", () => {
    const workbench = createApprovalWorkbench({
      campaignId: "camp_guarded",
      candidates: [{ id: "creator_1", target: "@creator" }],
      messages: [{ id: "copy_1", body: "Approved later" }]
    });

    expect(() =>
      claimCandidate(workbench, { candidateId: "creator_1", operator: "operator-a" })
    ).toThrow("must be approved");

    const approvedCandidate = approveCandidate(workbench, {
      candidateId: "creator_1",
      actor: "approver"
    });
    const claimed = claimCandidate(approvedCandidate, {
      candidateId: "creator_1",
      operator: "operator-a"
    });

    expect(() =>
      recordSendEvidence(claimed, {
        candidateId: "creator_1",
        messageId: "copy_1",
        operator: "operator-a"
      })
    ).toThrow("Message copy_1 must be approved");

    const approvedMessage = approveMessage(claimed, {
      messageId: "copy_1",
      actor: "approver"
    });

    expect(() =>
      recordSendEvidence(approvedMessage, {
        candidateId: "creator_1",
        messageId: "copy_1",
        operator: "operator-b"
      })
    ).toThrow("claimed by operator-a");
  });

  it("records skip and block evidence as terminal operator decisions", () => {
    let workbench = createApprovalWorkbench({
      campaignId: "camp_terminal",
      candidates: [
        { id: "skip_me", target: "@skip.me" },
        { id: "block_me", target: "@block.me" }
      ],
      messages: [{ id: "copy_1", body: "Hello" }]
    });

    workbench = approveCandidate(workbench, {
      candidateId: "skip_me",
      actor: "approver"
    });
    workbench = approveCandidate(workbench, {
      candidateId: "block_me",
      actor: "approver"
    });
    workbench = claimCandidate(workbench, {
      candidateId: "skip_me",
      operator: "operator-a"
    });
    workbench = claimCandidate(workbench, {
      candidateId: "block_me",
      operator: "operator-b"
    });
    workbench = skipCandidate(workbench, {
      candidateId: "skip_me",
      operator: "operator-a",
      reason: "duplicate found in external suppression sheet",
      evidence: { reference: "sheet://row/42" }
    });
    workbench = blockCandidate(workbench, {
      candidateId: "block_me",
      operator: "operator-b",
      reason: "creator has no defensible provenance",
      evidence: { source: "operator-review" }
    });

    expect(workbench.candidates.map((candidate) => candidate.work)).toEqual([
      "skipped",
      "blocked"
    ]);
    expect(workbench.summary.candidates).toMatchObject({
      approved: 2,
      claimed: 0,
      skipped: 1,
      blocked: 1
    });
    expect(workbench.audit.slice(-2).map((entry) => entry.action)).toEqual([
      "candidate_skipped",
      "candidate_blocked"
    ]);
  });

  it("rejects candidates and copy with audit reasons", () => {
    let workbench = createApprovalWorkbench({
      campaignId: "camp_rejections",
      candidates: [{ id: "creator_1", target: "@creator" }],
      messages: [{ id: "copy_1", body: "Too pushy" }]
    });

    workbench = rejectCandidate(workbench, {
      candidateId: "creator_1",
      actor: "approver",
      reason: "poor fit"
    });
    workbench = rejectMessage(workbench, {
      messageId: "copy_1",
      actor: "approver",
      reason: "tone mismatch"
    });

    expect(workbench.candidates[0]).toMatchObject({
      approval: "rejected",
      work: "blocked",
      reason: "poor fit"
    });
    expect(workbench.messages[0]).toMatchObject({
      approval: "rejected",
      reason: "tone mismatch"
    });
    expect(workbench.summary).toMatchObject({
      candidates: { rejected: 1, blocked: 1 },
      messages: { rejected: 1 }
    });
  });
});
