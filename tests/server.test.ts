import { buildServer } from "../src/server.js";

describe("API", () => {
  it("accepts campaign creation through POST /campaigns", async () => {
    const app = await buildServer({ webhookSecret: "test-secret" });

    const response = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1", "instagram_profile_2"],
        message: "Hey - loved your content. Open to an affiliate partnership?",
        campaign: "client_creator_outreach_may_2026"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "queued",
      summary: {
        total: 2,
        scheduled: 2
      }
    });

    await app.close();
  });

  it("updates campaign status from provider events", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1"],
        message: "Hey - loved your content.",
        campaign: "pilot"
      }
    });
    const campaignId = createResponse.json().campaignId;

    const eventResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/events`,
      payload: {
        target: "instagram_profile_1",
        event: "reply",
        eventId: "evt_1"
      }
    });

    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.json()).toMatchObject({
      status: "completed",
      summary: {
        replied: 1
      }
    });

    await app.close();
  });

  it("returns validation errors for invalid campaigns", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: [],
        campaign: "missing_message"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");

    await app.close();
  });

  it("honors idempotency-key headers for campaign creation", async () => {
    const app = await buildServer();
    const payload = {
      targets: ["instagram_profile_1"],
      message: "Hey - loved your content.",
      campaign: "pilot"
    };

    const first = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: {
        "idempotency-key": "pilot-idempotency-key"
      },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: {
        "idempotency-key": "pilot-idempotency-key"
      },
      payload: {
        ...payload,
        targets: ["instagram_profile_2"]
      }
    });

    expect(second.statusCode).toBe(202);
    expect(second.json().campaignId).toBe(first.json().campaignId);
    expect(second.json().targets[0].handle).toBe("instagram_profile_1");

    await app.close();
  });

  it("suppresses duplicate handles from earlier campaigns", async () => {
    const app = await buildServer();

    await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1"],
        message: "Hey - loved your content.",
        campaign: "pilot-a"
      }
    });
    const second = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1", "instagram_profile_2"],
        message: "Fresh campaign",
        campaign: "pilot-b"
      }
    });

    expect(second.statusCode).toBe(202);
    expect(second.json().targets.map((target: { status: string }) => target.status)).toEqual([
      "skipped_duplicate",
      "scheduled"
    ]);

    await app.close();
  });

  it("returns sender health when account state blocks scheduling", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["instagram_profile_1"],
        message: "Hey - loved your content.",
        campaign: "sender-health",
        settings: {
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "locked",
              dailyLimit: 5,
              riskEvents: [
                {
                  kind: "lockout",
                  at: "2026-05-30T00:00:00.000Z",
                  note: "Login checkpoint"
                }
              ]
            }
          ]
        }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "failed",
      summary: {
        blockedPolicy: 1
      },
      senderHealth: {
        total: 1,
        available: 0,
        blocked: 1,
        accounts: [
          {
            id: "sender-a",
            status: "locked",
            available: false,
            blockers: ["locked"]
          }
        ]
      }
    });

    await app.close();
  });

  it("persists approval workbench decisions and executes stored approvals", async () => {
    const app = await buildServer({ webhookSecret: "approval-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@approved_creator", "@rejected_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "approval-api-pilot",
        settings: {
          webhookUrl: "https://example.com/webhooks/inschneidergram",
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "healthy",
              dailyLimit: 20,
              riskEvents: []
            }
          ]
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    const createdWorkbench = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approveMessage: false
      }
    });
    expect(createdWorkbench.statusCode).toBe(200);
    expect(createdWorkbench.json().approvalWorkbench).toMatchObject({
      campaignId,
      summary: {
        candidates: {
          total: 2,
          pending: 2
        },
        messages: {
          pending: 1
        }
      }
    });

    const candidateIds = Object.fromEntries(
      createdWorkbench
        .json()
        .approvalWorkbench.candidates.map((candidate: { id: string; handle: string }) => [
          candidate.handle,
          candidate.id
        ])
    );
    const copyId = createdWorkbench.json().approvalWorkbench.messages[0].id;

    const approvedCandidate = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.approved_creator}/decision`,
      payload: {
        decision: "approved",
        actor: "approver",
        reason: "strong fit"
      }
    });
    expect(approvedCandidate.statusCode).toBe(200);

    const rejectedCandidate = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.rejected_creator}/decision`,
      payload: {
        decision: "rejected",
        actor: "approver",
        reason: "weak fit"
      }
    });
    expect(rejectedCandidate.statusCode).toBe(200);

    const approvedMessage = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/messages/${copyId}/decision`,
      payload: {
        decision: "approved",
        actor: "approver",
        reason: "brand safe"
      }
    });
    expect(approvedMessage.statusCode).toBe(200);
    expect(approvedMessage.json().approvalWorkbench.summary).toMatchObject({
      candidates: {
        approved: 1,
        rejected: 1,
        blocked: 1
      },
      messages: {
        approved: 1
      }
    });

    const storedWorkbench = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/approval-workbench`
    });
    expect(storedWorkbench.json().approvalWorkbench.audit.map(
      (entry: { action: string }) => entry.action
    )).toEqual([
      "workbench_created",
      "candidate_approved",
      "candidate_rejected",
      "message_approved"
    ]);

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "mock",
          replyTargets: ["@approved_creator"]
        }
      }
    });
    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json()).toMatchObject({
      summary: {
        scheduled: 1,
        replied: 1
      },
      proofPack: {
        metrics: {
          approvedTargets: 1,
          approvedCopy: 1,
          contactedTargets: 1,
          replies: 1
        }
      }
    });
    expect(
      executionResponse.json().intents.map((intent: { targetHandle: string }) => intent.targetHandle)
    ).toEqual(["approved_creator"]);
    expect(executionResponse.json().execution.approvalWorkbench.summary).toMatchObject({
      candidates: {
        approved: 1,
        rejected: 1
      }
    });

    await app.close();
  });

  it("persists operator work state and excludes skipped candidates from execution", async () => {
    const app = await buildServer({ webhookSecret: "operator-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@send_creator", "@skip_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "operator-workbench-pilot",
        settings: {
          webhookUrl: "https://example.com/webhooks/inschneidergram",
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "healthy",
              dailyLimit: 20,
              riskEvents: []
            }
          ]
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    const createdWorkbench = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench`,
      payload: {
        approvedTargets: ["@send_creator", "@skip_creator"],
        approveMessage: true,
        actor: "approver"
      }
    });
    const candidateIds = Object.fromEntries(
      createdWorkbench
        .json()
        .approvalWorkbench.candidates.map((candidate: { id: string; handle: string }) => [
          candidate.handle,
          candidate.id
        ])
    );

    const claimResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.skip_creator}/claim`,
      payload: {
        operator: "operator-a"
      }
    });
    expect(claimResponse.statusCode).toBe(200);
    expect(claimResponse.json().approvalWorkbench.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: candidateIds.skip_creator,
          work: "claimed",
          claimedBy: "operator-a"
        })
      ])
    );

    const skipResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/approval-workbench/candidates/${candidateIds.skip_creator}/work`,
      payload: {
        work: "skipped",
        operator: "operator-a",
        reason: "duplicate found in external sheet",
        evidence: {
          source: "operator-review",
          reference: "sheet://row/42"
        }
      }
    });
    expect(skipResponse.statusCode).toBe(200);
    expect(skipResponse.json().approvalWorkbench.summary.candidates).toMatchObject({
      approved: 2,
      skipped: 1
    });

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "mock",
          replyTargets: ["@send_creator"]
        }
      }
    });
    expect(executionResponse.statusCode).toBe(200);
    expect(
      executionResponse.json().intents.map((intent: { targetHandle: string }) => intent.targetHandle)
    ).toEqual(["send_creator"]);
    expect(executionResponse.json()).toMatchObject({
      summary: {
        scheduled: 1,
        replied: 1
      },
      proofPack: {
        metrics: {
          approvedTargets: 2,
          contactedTargets: 1,
          replies: 1
        }
      }
    });
    expect(executionResponse.json().execution.approvalWorkbench.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: candidateIds.skip_creator,
          work: "skipped",
          reason: "duplicate found in external sheet"
        })
      ])
    );

    await app.close();
  });

  it("executes an approved mock pilot and returns proof pack evidence", async () => {
    const app = await buildServer({ webhookSecret: "execution-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@creator_one", "@creator_two", "@creator_three"],
        message: "Open to an affiliate pilot?",
        campaign: "api-execution-pilot",
        settings: {
          webhookUrl: "https://example.com/webhooks/inschneidergram",
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "healthy",
              dailyLimit: 20,
              riskEvents: []
            }
          ]
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: {
          kind: "mock",
          replyTargets: ["@creator_two"],
          failingTargets: ["@creator_three"]
        },
        replyAssessments: [
          {
            targetHandle: "creator_two",
            disposition: "interested",
            qualified: true,
            replyText: "Interested - send details"
          }
        ],
        incidents: [
          {
            kind: "manual_note",
            severity: "info",
            at: "2026-05-30T01:30:00.000Z",
            note: "API execution dry run"
          }
        ]
      }
    });

    expect(executionResponse.statusCode).toBe(200);
    const executionId = executionResponse.json().executionId;
    expect(executionId).toMatch(/^exec_/);
    expect(executionResponse.json()).toMatchObject({
      status: "running",
      summary: {
        sent: 1,
        replied: 1,
        failed: 1
      },
      adapterRiskPosture: {
        kind: "mock",
        officialColdDmCompliance: "not_claimed"
      },
      proofPack: {
        metrics: {
          approvedTargets: 3,
          contactedTargets: 2,
          interestedReplies: 1,
          webhookDelivered: 4
        },
        renewalRecommendation: {
          decision: "renew"
        }
      }
    });
    expect(executionResponse.json().execution).toMatchObject({
      id: executionId,
      campaignId,
      proofPack: {
        metrics: {
          interestedReplies: 1
        }
      }
    });
    expect(executionResponse.json().deliveryAttempts).toHaveLength(3);
    expect(executionResponse.json().webhookDeliveries).toHaveLength(4);
    expect(executionResponse.json().proofPack.markdown).toContain("Decision: renew");

    const stored = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}`
    });
    expect(stored.json().summary).toMatchObject({
      replied: 1,
      failed: 1
    });

    const executions = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions`
    });
    expect(executions.json()).toMatchObject({
      campaignId,
      executions: [
        {
          id: executionId,
          proofPack: {
            renewalRecommendation: {
              decision: "renew"
            }
          }
        }
      ]
    });

    const executionRecord = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions/${executionId}`
    });
    expect(executionRecord.json()).toMatchObject({
      id: executionId,
      campaignId,
      adapterRiskPosture: {
        kind: "mock",
        officialColdDmCompliance: "not_claimed"
      }
    });

    const manualEvidenceForMock = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        target: "@creator_one",
        type: "sent",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/creator_one",
          screenshotUrl: "s3://proof/mock-manual.png"
        }
      }
    });
    expect(manualEvidenceForMock.statusCode).toBe(409);
    expect(manualEvidenceForMock.json()).toMatchObject({
      error: "conflict"
    });

    await app.close();
  });

  it("supports manual-safe execution without claiming live Instagram delivery", async () => {
    const app = await buildServer();
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@creator_one"],
        message: "Open to an affiliate pilot?",
        campaign: "manual-safe-pilot"
      }
    });

    const executionResponse = await app.inject({
      method: "POST",
      url: `/campaigns/${createResponse.json().campaignId}/executions`,
      payload: {
        adapter: {
          kind: "manual"
        }
      }
    });

    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json()).toMatchObject({
      adapterRiskPosture: {
        kind: "manual",
        officialColdDmCompliance: "not_claimed",
        requiresHumanEvidence: true
      },
      proofPack: {
        metrics: {
          contactedTargets: 0,
          sentMessages: 0
        },
        renewalRecommendation: {
          decision: "iterate"
        }
      }
    });

    await app.close();
  });

  it("records manual execution evidence and refreshes persisted proof", async () => {
    const app = await buildServer({ webhookSecret: "manual-secret" });
    const createResponse = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        targets: ["@manual_creator"],
        message: "Open to an affiliate pilot?",
        campaign: "manual-evidence-pilot",
        settings: {
          webhookUrl: "https://example.com/webhooks/inschneidergram",
          senderPool: ["sender-a"],
          senderAccounts: [
            {
              id: "sender-a",
              status: "healthy",
              dailyLimit: 20,
              riskEvents: []
            }
          ]
        }
      }
    });
    const campaignId = createResponse.json().campaignId;

    const manualExecution = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions`,
      payload: {
        adapter: { kind: "manual" }
      }
    });
    expect(manualExecution.statusCode).toBe(200);
    const executionId = manualExecution.json().executionId;
    expect(manualExecution.json().deliveryAttempts[0]).toMatchObject({
      outcome: "needs_manual_evidence",
      riskPosture: {
        kind: "manual",
        requiresHumanEvidence: true
      }
    });
    expect(manualExecution.json().proofPack.metrics.contactedTargets).toBe(0);

    const unknownIntent = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        intentId: "intent_missing",
        type: "sent",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-missing.png"
        }
      }
    });
    expect(unknownIntent.statusCode).toBe(404);
    expect(unknownIntent.json()).toMatchObject({
      error: "not_found"
    });

    const incompleteEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        target: "@manual_creator",
        type: "sent",
        evidence: {
          operatorId: "op_1"
        }
      }
    });
    expect(incompleteEvidence.statusCode).toBe(400);
    expect(incompleteEvidence.json().message).toContain("Missing manual evidence for sent");

    const sentEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      headers: {
        "idempotency-key": "manual-sent-1"
      },
      payload: {
        target: "@manual_creator",
        type: "sent",
        messageId: "manual_msg_1",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-sent.png"
        }
      }
    });
    expect(sentEvidence.statusCode).toBe(200);
    expect(sentEvidence.json()).toMatchObject({
      summary: {
        sent: 1
      },
      event: {
        id: "manual-sent-1",
        type: "sent",
        messageId: "manual_msg_1"
      },
      proofPack: {
        metrics: {
          approvedTargets: 1,
          contactedTargets: 1,
          webhookDelivered: 1
        }
      }
    });

    const repeatedSentEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      headers: {
        "idempotency-key": "manual-sent-1"
      },
      payload: {
        target: "@manual_creator",
        type: "sent",
        messageId: "manual_msg_1",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-sent.png"
        }
      }
    });
    expect(repeatedSentEvidence.statusCode).toBe(200);
    expect(repeatedSentEvidence.json()).toMatchObject({
      summary: {
        sent: 1
      },
      proofPack: {
        metrics: {
          webhookDelivered: 1
        }
      }
    });

    const replyEvidence = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/executions/${executionId}/manual-events`,
      payload: {
        eventId: "manual-reply-1",
        target: "@manual_creator",
        type: "replied",
        messageId: "manual_msg_1",
        replyText: "Interested - send details",
        evidence: {
          operatorId: "op_1",
          conversationUrl: "https://instagram.com/direct/t/manual_creator",
          screenshotUrl: "s3://proof/manual-reply.png",
          replyCapturedAt: "2026-05-30T01:45:00.000Z"
        },
        replyAssessment: {
          disposition: "interested",
          qualified: true,
          note: "Qualified creator asked for the brief"
        }
      }
    });
    expect(replyEvidence.statusCode).toBe(200);
    expect(replyEvidence.json()).toMatchObject({
      summary: {
        replied: 1
      },
      proofPack: {
        metrics: {
          approvedTargets: 1,
          contactedTargets: 1,
          sentMessages: 1,
          replies: 1,
          interestedReplies: 1,
          webhookDelivered: 2
        },
        renewalRecommendation: {
          decision: "renew"
        }
      }
    });
    expect(
      replyEvidence.json().execution.deliveryAttempts[0].events.map(
        (event: { type: string }) => event.type
      )
    ).toEqual(["sent", "replied"]);

    const storedExecution = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/executions/${executionId}`
    });
    expect(storedExecution.json()).toMatchObject({
      id: executionId,
      proofPack: {
        metrics: {
          approvedTargets: 1,
          interestedReplies: 1
        }
      }
    });

    await app.close();
  });

  it("documents the execution workflow in OpenAPI", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/openapi.json"
    });
    const openapi = response.json();

    expect(openapi.paths["/campaigns/{id}/executions"].get).toMatchObject({
      summary: "List persisted execution proof records for a campaign"
    });
    expect(openapi.paths["/campaigns/{id}/approval-workbench"].post).toMatchObject({
      summary: "Create or replace a persisted approval workbench"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/candidates/{candidateId}/decision"].post
    ).toMatchObject({
      summary: "Approve or reject one creator candidate"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/messages/{messageId}/decision"].post
    ).toMatchObject({
      summary: "Approve or reject one message candidate"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/candidates/{candidateId}/claim"].post
    ).toMatchObject({
      summary: "Claim one approved creator candidate for operator work"
    });
    expect(
      openapi.paths["/campaigns/{id}/approval-workbench/candidates/{candidateId}/work"].post
    ).toMatchObject({
      summary: "Mark one claimed creator candidate skipped or blocked"
    });
    expect(openapi.paths["/campaigns/{id}/executions"].post).toMatchObject({
      summary: "Execute approved campaign targets through a mock or manual-safe adapter",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              properties: {
                adapter: expect.any(Object),
                approvals: expect.any(Object),
                replyAssessments: expect.any(Object)
              }
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Safe execution completed and proof pack returned"
        }
      }
    });
    expect(openapi.paths["/campaigns/{id}/executions/{executionId}"].get).toMatchObject({
      summary: "Get one persisted execution proof record"
    });
    expect(openapi.paths["/campaigns/{id}/executions/{executionId}/manual-events"].post).toMatchObject({
      summary: "Record manual evidence for one execution intent",
      responses: {
        "409": {
          description: "Execution or manual event state conflict"
        }
      }
    });

    await app.close();
  });
});
