import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as admission from
  "../src/operations/stagingPhase1V2Admission.js";
import * as observer from
  "../src/operations/stagingPhase1V2MachineObserver.js";

const PROJECT = "mbvzwsrtqcrwhvykugcd";
const ORGANIZATION = "wbnftkftyamxzvxsftda";
const REGION = "eu-central-1";
const CANDIDATE = "b59f432a1947154345f1629ecba50d14fcb1e7c8";
const TREE = "0".repeat(40);
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const OTHER_RUN = "33333333-3333-4333-8333-333333333333";
const AUTHORIZATION_DIGEST = "a".repeat(64);
const OPERATOR_DIGEST = "b".repeat(64);
const FIXTURE_SEAM =
  "STAGING_PHASE1_V2_PRODUCTION_OBSERVER_SECURITY_ACCEPTANCE_FIXTURES";
const ADVISOR_COMMIT_TIME = "2026-08-30T10:00:00.000Z";
const ADVISOR_OBSERVED_TIME = "2026-08-30T10:00:01.000Z";
const ARTIFACT_PHASES = Object.freeze([
  "pre-control",
  "post-ddl-advisors",
  "final-control",
  "post-disconnect-cleanup"
]);
const ARTIFACT_DOMAIN = "trailmind-production-observer-v1";
const ACCEPTANCE_KEYS = generateKeyPairSync("ed25519");
const ACCEPTANCE_PUBLIC_KEY_DER = ACCEPTANCE_KEYS.publicKey.export({
  format: "der",
  type: "spki"
});
const ACCEPTANCE_PUBLIC_KEY_DIGEST = sha256(ACCEPTANCE_PUBLIC_KEY_DER);
const OBSERVER_SOURCE_URL = new URL(
  "../src/operations/stagingPhase1V2MachineObserver.js",
  import.meta.url
);
const LAUNCHER_SOURCE_URL = new URL(
  "../src/operations/stagingPhase1V2LiveLauncher.js",
  import.meta.url
);
const OBSERVER_SOURCE = readFileSync(OBSERVER_SOURCE_URL, "utf8");
const LAUNCHER_SOURCE = readFileSync(LAUNCHER_SOURCE_URL, "utf8");

describe("staging Phase 1 V2 production observer security acceptance", () => {
  describe("advisor admission", () => {
    for (const level of ["ERROR", "WARN"]) {
      it(`blocks ${level} advisor lints`, () => {
        const result = parseAdvisorForAdmission(
          "security",
          advisorResponse({ level, category: "SECURITY" })
        );
        assert.equal(result.blocked, true,
          `${level} must never reach an admitting artifact`);
      });
    }

    it("keeps reviewed INFO advisor lints notice-only", () => {
      const result = parseAdvisorForAdmission(
        "performance",
        advisorResponse({ level: "INFO", category: "PERFORMANCE" })
      );
      assert.deepEqual(result, { blocked: false, noticeCount: 1 });
    });

    for (const [name, mutate] of [
      ["unknown level", (value) => { value.lints[0].level = "NOTICE"; }],
      ["unknown category", (value) => {
        value.lints[0].categories = ["SECURITY", "UNKNOWN"];
      }],
      ["missing level", (value) => { delete value.lints[0].level; }],
      ["unknown response field", (value) => { value.partial = false; }]
    ]) {
      it(`blocks advisor ${name}`, () => {
        const value = advisorResponse({
          level: "INFO",
          category: "SECURITY"
        });
        mutate(value);
        assert.throws(
          () => observer.validateStagingPhase1V2ControlResponseFixture(
            "security", value
          ),
          isObserverFailure()
        );
      });
    }

    it("blocks duplicate advisor lint identities", () => {
      const value = advisorResponse({
        level: "INFO",
        category: "SECURITY"
      });
      value.lints.push(structuredClone(value.lints[0]));
      assert.throws(
        () => observer.validateStagingPhase1V2ControlResponseFixture(
          "security", value
        ),
        isObserverFailure("advisor_unknown_lint")
      );
    });
  });

  describe("billing evidence", () => {
    it("binds billing evidence to the fixed provider endpoint and permission", () => {
      const requests =
        observer.STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.requests;
      assert.deepEqual(requests.billing, {
        maximumBytes: 32 * 1024,
        method: "GET",
        path: `/v1/projects/${PROJECT}/billing/addons`,
        requiredPermission: "infra_add_ons_read"
      });
    });

    it("does not hard-code or infer zero billing fields", () => {
      const body = sourceBetween(
        OBSERVER_SOURCE,
        "async function observeControlPlane",
        "async function requestControlJson"
      );
      assert.equal(
        /monthlyCostAmount\s*:\s*0\b/.test(body),
        false,
        "monthly cost must come from validated provider evidence"
      );
      assert.equal(
        /nonzeroAddonCount\s*:\s*0\b/.test(body),
        false,
        "addon count must come from validated provider evidence"
      );
    });

    it("validates the complete billing acceptance corpus", () => {
      const validate = fixtureMethod("validateBillingEvidence");
      assert.doesNotThrow(() => validate(billingEvidence()));
      for (const [name, value] of [
        ["free plan inference", { organizationPlan: "free" }],
        ["nano compute inference", { computeSize: "nano" }],
        ["absent addons", {
          ...billingEvidence(),
          selectedAddons: undefined
        }],
        ["runtime zero assertion", {
          monthlyCostAmount: 0,
          nonzeroAddonCount: 0
        }],
        ["wrong permission", {
          ...billingEvidence(),
          permission: "projects:read"
        }],
        ["wrong endpoint", {
          ...billingEvidence(),
          path: `/v1/projects/${PROJECT}`
        }]
      ]) {
        assert.throws(
          () => validate(structuredClone(value)),
          isObserverFailure("control_billing_capability_unavailable"),
          name
        );
      }
    });
  });

  describe("advisor freshness", () => {
    it("validates the complete provider-freshness acceptance corpus", () => {
      const validate = fixtureMethod("validateAdvisorFreshness");
      assert.doesNotThrow(() => validate(advisorFreshnessEvidence()));
      for (const [name, mutate] of [
        ["locally recent GET", (value) => {
          delete value.providerRecomputation;
        }],
        ["two identical GETs", (value) => {
          delete value.providerRecomputation;
          value.fetches = ["digest-a", "digest-a"];
        }],
        ["two changed GETs", (value) => {
          delete value.providerRecomputation;
          value.fetches = ["digest-a", "digest-b"];
        }],
        ["HTTP Date header", (value) => {
          delete value.providerRecomputation;
          value.dateHeader = ADVISOR_OBSERVED_TIME;
        }],
        ["pre-DDL provider marker", (value) => {
          value.providerRecomputation.completedAt =
            "2026-08-30T09:59:59.999Z";
        }],
        ["unbound marker", (value) => {
          value.providerRecomputation.ddlEvidenceDigest = "f".repeat(64);
        }]
      ]) {
        const value = advisorFreshnessEvidence();
        mutate(value);
        assert.throws(
          () => validate(value),
          isObserverFailure("advisor_freshness_unproved"),
          name
        );
      }
    });
  });

  describe("dedicated auditor identity", () => {
    it("accepts the exact pre-provisioned least-privilege role contract", () => {
      assert.doesNotThrow(() =>
        observer.validateStagingPhase1V2AuditorIdentityFixture(
          dedicatedAuditorIdentity()
        )
      );
    });

    it("rejects the candidate postgres/mutator auditor false green", () => {
      assert.throws(
        () => observer.validateStagingPhase1V2AuditorIdentityFixture(
          candidatePostgresAuditorIdentity()
        ),
        isObserverFailure("auditor_role")
      );
    });

    for (const role of [
      "supabase_admin",
      "supabase_read_only_user",
      "readonly_auditor_role"
    ]) {
      it(`rejects ${role} as auditor`, () => {
        const value = dedicatedAuditorIdentity();
        value.row.session_user = role;
        value.row.current_user = role;
        assert.throws(
          () => observer.validateStagingPhase1V2AuditorIdentityFixture(value),
          isObserverFailure()
        );
      });
    }

    for (const [name, mutate] of [
      ["SUPERUSER", (row) => { row.rolsuper = true; }],
      ["BYPASSRLS", (row) => { row.rolbypassrls = true; }],
      ["CREATEDB", (row) => { row.rolcreatedb = true; }],
      ["CREATEROLE", (row) => { row.rolcreaterole = true; }],
      ["replication", (row) => { row.rolreplication = true; }],
      ["missing pg_read_all_stats", (row) => {
        row.can_read_all_stats = false;
        row.memberships = [];
      }],
      ["shared mutator credential", (row) => {
        row.credential_distinct_from_mutator = false;
      }],
      ["transaction pool", (row) => { row.pool_mode = "transaction"; }],
      ["product-data grant", (row) => {
        row.product_data_grants = ["trailmind_app.routes:SELECT"];
      }]
    ]) {
      it(`rejects auditor ${name}`, () => {
        const value = dedicatedAuditorIdentity();
        mutate(value.row);
        assert.throws(
          () => observer.validateStagingPhase1V2AuditorIdentityFixture(value),
          isObserverFailure()
        );
      });
    }
  });

  describe("run-derived mutating database identity", () => {
    it("derives the exact application identity from the run binding", () => {
      const derive = fixtureMethod("deriveMutatingApplicationIdentity");
      const binding = mutatorBinding();
      const result = derive(structuredClone(binding));
      const digest = sha256(canonicalJson(binding));
      assert.deepEqual(result, {
        applicationName: `trailmind_p1v2_${digest.slice(0, 24)}`,
        databaseRunBindingDigest: digest
      });
    });

    it("produces distinct application identities across run and attempt IDs", () => {
      const derive = fixtureMethod("deriveMutatingApplicationIdentity");
      const first = derive(mutatorBinding());
      const second = derive({
        ...mutatorBinding(),
        attemptId: "44444444-4444-4444-8444-444444444444",
        runId: OTHER_RUN
      });
      assert.notEqual(first.applicationName, second.applicationName);
      assert.notEqual(
        first.databaseRunBindingDigest,
        second.databaseRunBindingDigest
      );
    });

    it("does not expose the fixed candidate application name as admission", () => {
      assert.notEqual(
        admission.STAGING_PHASE1_V2_APPLICATION_NAME,
        "trailmind_phase1_v2_operator"
      );
    });
  });

  describe("cleanup proof", () => {
    it("rejects the candidate one-sample zero false green", () => {
      assert.throws(
        () => observer.validateStagingPhase1V2CleanupResultFixture({
          row: {
            active_session_count: 0,
            auditor_excluded: null,
            exact_session_count: 0,
            idle_session_count: 0
          },
          rowCount: 1
        }),
        isObserverFailure("cleanup_unproved")
      );
    });

    it("validates the complete two-sample cleanup acceptance corpus", () => {
      const validate = fixtureMethod("validateCleanupEvidence");
      assert.doesNotThrow(() => validate(cleanupEvidence()));
      for (const [name, mutate, code] of [
        ["one sample", (value) => { value.samples.pop(); },
          "cleanup_unproved"],
        ["cached snapshot", (value) => {
          value.samples[1].statsSnapshotCleared = false;
        }, "cleanup_visibility"],
        ["privilege-blind zero", (value) => {
          value.samples[0].visibilityContractVerified = false;
        }, "cleanup_visibility"],
        ["mismatched PID", (value) => { value.samples[1].backendPid += 1; },
          "cleanup_unproved"],
        ["mismatched backend_start", (value) => {
          value.samples[1].backendStart = "2026-08-30T09:59:59.000Z";
        }, "cleanup_unproved"],
        ["mismatched application", (value) => {
          value.samples[1].applicationName += "_other";
        }, "cleanup_unproved"],
        ["mismatched run", (value) => { value.samples[1].runId = OTHER_RUN; },
          "cleanup_unproved"],
        ["nonconsecutive samples", (value) => {
          value.samples[1].sequence = 3;
        }, "cleanup_unproved"],
        ["reconnect", (value) => {
          value.samples[1].reconnectDetected = true;
        }, "cleanup_race"],
        ["active row", (value) => {
          value.samples[1].activeSessionCount = 1;
        }, "cleanup_pending"],
        ["idle row", (value) => {
          value.samples[1].idleExactInstanceCount = 1;
        }, "cleanup_pending"],
        ["late session", (value) => {
          value.samples[1].matchingApplicationCount = 1;
        }, "cleanup_race"],
        ["sample before disconnect", (value) => {
          value.target.disconnectConfirmedAt = "2026-08-30T10:00:01.500Z";
        }, "cleanup_race"]
      ]) {
        const value = cleanupEvidence();
        mutate(value);
        assert.throws(
          () => validate(value),
          isObserverFailure(code),
          name
        );
      }
    });
  });

  describe("signed durable artifact chain", () => {
    it("has a fully offline positive control with an ephemeral Ed25519 key", () => {
      const chain = signedArtifactChain();
      assert.doesNotThrow(() => referenceValidateSignedChain(chain));
      assert.equal(chain.artifacts.length, 4);
      assert.equal(ACCEPTANCE_KEYS.privateKey.type, "private");
    });

    it("validates the complete signed durable artifact acceptance corpus", () => {
      const validate = fixtureMethod("validateArtifactChain");
      assert.equal(Object.isFrozen(observer[FIXTURE_SEAM]), true);
      assert.doesNotThrow(() => validate(signedArtifactChain()));
      const attacks = [
        ["missing signature", (value) => {
          delete value.artifacts[0].signature;
        }, "observer_signature"],
        ["unkeyed digest-only evidence", (value) => {
          for (const artifact of value.artifacts) delete artifact.signature;
        }, "observer_signature"],
        ["dynamic public key", (value) => {
          const keys = generateKeyPairSync("ed25519");
          value.trustAnchor = {
            mode: "runtime-supplied",
            publicKeyDerBase64: keys.publicKey.export({
              format: "der", type: "spki"
            }).toString("base64"),
            publicKeyDigest: "0".repeat(64)
          };
        }, "observer_signature_key"],
        ["wrong pinned-key digest", (value) => {
          value.trustAnchor.publicKeyDigest = "f".repeat(64);
        }, "observer_signature_key"],
        ["invalid signature", (value) => {
          value.artifacts[1].signature.valueBase64 =
            Buffer.alloc(64, 7).toString("base64");
        }, "observer_signature"],
        ["broken predecessor", (value) => {
          value.artifacts[2].previousArtifactDigest = "d".repeat(64);
        }, "observer_order"],
        ["reordered phases", (value) => {
          [value.artifacts[1], value.artifacts[2]] =
            [value.artifacts[2], value.artifacts[1]];
        }, "observer_order"],
        ["duplicate phase", (value) => {
          value.artifacts[2] = structuredClone(value.artifacts[1]);
        }, "observer_order"],
        ["non-O_EXCL creation", (value) => {
          value.persistence[0].createdExclusively = false;
        }, "observer_persistence"],
        ["permissive artifact mode", (value) => {
          value.persistence[0].mode = "0644";
        }, "observer_persistence"],
        ["missing file fsync", (value) => {
          value.persistence[1].fileFsync = false;
        }, "observer_persistence"],
        ["missing directory fsync", (value) => {
          value.persistence[2].directoryFsync = false;
        }, "observer_persistence"],
        ["cross-run replay", (value) => {
          value.expectedBinding.runId = OTHER_RUN;
        }, "observer_cross_binding"],
        ["mutation after signing", (value) => {
          value.artifacts[3].evidence.cleanupSamples[0]
            .matchingApplicationCount = 1;
        }, "observer_signature"],
        ["publication before all artifacts", (value) => {
          value.terminalPublication.allArtifactsExisted = false;
        }, "receipt_publication_unproved"]
      ];
      for (const [name, mutate, code] of attacks) {
        const value = signedArtifactChain();
        mutate(value);
        assert.throws(() => referenceValidateSignedChain(value));
        assert.throws(
          () => validate(value),
          isObserverFailure(code),
          name
        );
      }
    });

    it("production seal uses a pinned Ed25519 signature, not SHA-256 alone", () => {
      const body = sourceBetween(
        OBSERVER_SOURCE,
        "function sealMachineArtifact",
        "function productionControlEvidence"
      );
      assert.equal(/Ed25519/.test(body), true,
        "production artifact seal must use Ed25519");
      assert.equal(/signature/.test(body), true,
        "production artifact seal must include a signature");
      assert.equal(
        /artifactDigest\s*:\s*sha256\(canonicalJson\(unsigned\)\)/.test(body),
        false,
        "unkeyed artifact digests cannot authenticate production evidence"
      );
    });

    it("persists all four observer artifacts before terminal publication", () => {
      for (const suffix of [
        "observer.01.pre-control.json",
        "observer.02.post-ddl-advisors.json",
        "observer.03.final-control.json",
        "observer.04.post-disconnect-cleanup.json"
      ]) {
        assert.equal(
          LAUNCHER_SOURCE.includes(suffix),
          true,
          `missing durable artifact ${suffix}`
        );
      }
      const lastArtifact = LAUNCHER_SOURCE.indexOf(
        "observer.04.post-disconnect-cleanup.json"
      );
      const publication = LAUNCHER_SOURCE.indexOf("createDurableReceiptStore");
      assert.ok(lastArtifact >= 0 && publication > lastArtifact);
    });
  });

  describe("OAuth token containment", () => {
    it("accepts an exact short-lived read-scoped OAuth access token fixture", () => {
      assert.deepEqual(
        observer.validateStagingPhase1V2ControlCredentialTypeFixture(
          oauthAccessToken()
        ),
        { accepted: true }
      );
    });

    const forbiddenCredentials = [
      ["PAT", `sbp_${"x".repeat(48)}`],
      ["service role", jwt({ role: "service_role" })],
      ["publishable key", `sb_publishable_${"x".repeat(48)}`],
      ["anon JWT", jwt({ role: "anon" })],
      ["refresh token", `oauth_refresh_${"x".repeat(48)}`],
      ["client secret", `oauth_client_secret_${"x".repeat(48)}`],
      ["browser cookie", `sb-access-token=${"x".repeat(48)}`],
      ["MCP credential", `mcp_oauth_${"x".repeat(48)}`],
      ["arbitrary opaque string", `opaque_${"x".repeat(48)}`],
      ["OAuth token missing exact scopes", jwt({
        exp: 1_900_000_000,
        scope: "projects:read",
        token_use: "access"
      })]
    ];
    for (const [name, credential] of forbiddenCredentials) {
      it(`rejects ${name} credential material`, () => {
        assert.throws(
          () => observer.validateStagingPhase1V2ControlCredentialTypeFixture(
            credential
          ),
          isObserverFailure("control_credential_type")
        );
      });
    }

    it("rejects a nonzero descriptor offset before session creation", async () => {
      const credential = unlinkedDescriptor(oauthAccessToken(), {
        advanceOffset: true
      });
      try {
        assert.throws(
          () => observer.STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY
            .createSession(binding(), {
              controlCredentialFd: credential.fd
            }),
          isObserverFailure("control_credential_fd")
        );
      } finally {
        credential.dispose();
      }
    });

    it("rejects reuse of the same descriptor by multiple sessions", async () => {
      const credential = unlinkedDescriptor(oauthAccessToken());
      let first;
      let second;
      try {
        first = observer.STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY
          .createSession(binding(), { controlCredentialFd: credential.fd });
        assert.throws(
          () => {
            second = observer
              .STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY
              .createSession(binding(OTHER_RUN), {
                controlCredentialFd: credential.fd
              });
          },
          isObserverFailure("control_credential_fd")
        );
      } finally {
        await observer.disposeStagingPhase1V2ProductionObserverSession(first);
        await observer.disposeStagingPhase1V2ProductionObserverSession(second);
        credential.dispose();
      }
    });

    it("closes the credential descriptor on pre-control failure", async () => {
      const credential = unlinkedDescriptor(`sbp_${"x".repeat(48)}`);
      let session;
      try {
        session = observer.STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY
          .createSession(binding(), { controlCredentialFd: credential.fd });
        await assert.rejects(
          observer.prepareStagingPhase1V2ProductionPreControl(
            session,
            phaseRequest("pre-control")
          ),
          isObserverFailure("control_credential_type")
        );
        assert.throws(() => fstatSync(credential.fd), { code: "EBADF" });
      } finally {
        await observer.disposeStagingPhase1V2ProductionObserverSession(session);
        credential.dispose();
      }
    });

    it("reads the OAuth descriptor once for the session, not once per request", () => {
      const requestBody = sourceBetween(
        OBSERVER_SOURCE,
        "async function requestControlJson",
        "export function validateStagingPhase1V2ControlCredentialTypeFixture"
      );
      assert.equal(
        /readProtectedDescriptor\s*\(/.test(requestBody),
        false,
        "request transport must receive an already-contained token buffer"
      );
      assert.equal(
        /singleRead/.test(OBSERVER_SOURCE),
        true,
        "descriptor containment must record a single read"
      );
    });

    it("validates the complete descriptor lifecycle acceptance corpus", () => {
      const validate = fixtureMethod("validateDescriptorLifecycle");
      assert.doesNotThrow(() => validate(descriptorLifecycle()));
      for (const [name, mutate, code] of [
        ["inherited descriptor", (value) => { value.closeOnExec = false; },
          "control_auth_required"],
        ["linked descriptor", (value) => { value.linkCount = 1; },
          "control_auth_required"],
        ["permissive descriptor", (value) => { value.mode = "0644"; },
          "control_auth_required"],
        ["wrong descriptor offset", (value) => { value.offset = 1; },
          "control_auth_required"],
        ["descriptor reread", (value) => { value.readCount = 2; },
          "control_auth_required"],
        ["failure without wipe", (value) => {
          value.failure.closed = false;
          value.failure.wiped = false;
        }, "control_auth_required"],
        ["cancellation without wipe", (value) => {
          value.cancellation.closed = false;
          value.cancellation.wiped = false;
        }, "control_auth_required"]
      ]) {
        const value = descriptorLifecycle();
        mutate(value);
        assert.throws(
          () => validate(value),
          isObserverFailure(code),
          name
        );
      }
    });
  });

  describe("management transport", () => {
    it("pins exact reviewed GET paths, query strings and project refs", () => {
      const requests =
        observer.STAGING_PHASE1_V2_CONTROL_REQUEST_MANIFEST.requests;
      assert.equal(
        requests.project.path,
        `/v1/projects/${PROJECT}`
      );
      assert.equal(
        requests.organization.path,
        `/v1/organizations/${ORGANIZATION}`
      );
      assert.equal(
        requests.inventory.path,
        `/v1/organizations/${ORGANIZATION}/projects?limit=100&offset=0`
      );
      assert.equal(
        requests.security.path,
        `/v1/projects/${PROJECT}/advisors/security`
      );
      assert.equal(
        requests.performance.path,
        `/v1/projects/${PROJECT}/advisors/performance`
      );
    });

    it("validates the complete management transport acceptance corpus", () => {
      const validate = fixtureMethod("validateControlTransport");
      assert.doesNotThrow(() => validate(transportEvidence()));
      const attacks = [
      ["non-GET method", (value) => { value.request.method = "POST"; },
        "control_endpoint"],
      ["altered host", (value) => { value.request.host = "example.invalid"; },
        "control_endpoint"],
      ["altered path", (value) => { value.request.path += "/extra"; },
        "control_endpoint"],
      ["altered query", (value) => { value.request.path += "?extra=1"; },
        "control_endpoint"],
      ["protected Planua ref", (value) => {
        value.request.path = "/v1/projects/cmkvbxppgofteoutfslp";
      }, "control_endpoint"],
      ["protected production ref", (value) => {
        value.request.path = "/v1/projects/bejvhhjbgtvctpsnlwid";
      }, "control_endpoint"],
      ["redirect", (value) => { value.response.statusCode = 302; },
        "control_redirect"],
      ["retry", (value) => { value.request.attempt = 2; },
        "control_transport"],
      ["proxy", (value) => { value.request.proxyUsed = true; },
        "control_transport"],
      ["compression", (value) => {
        value.response.contentEncoding = "gzip";
      }, "control_response_bounds"],
      ["DNS rebinding", (value) => {
        value.dns.endAddresses = ["198.51.100.8"];
      }, "control_transport"],
      ["reserved address", (value) => {
        value.dns.startAddresses = ["203.0.113.8"];
        value.dns.endAddresses = ["203.0.113.8"];
      }, "control_transport"],
      ["hostname failure", (value) => { value.tls.hostnameVerified = false; },
        "control_transport"],
      ["TLS authorization failure", (value) => {
        value.tls.authorized = false;
      }, "control_transport"],
      ["malformed JSON body", (value) => { value.response.rawBody = "{"; },
        "control_response_bounds"],
      ["oversized body", (value) => {
        value.response.byteLength = 262_145;
      }, "control_response_bounds"],
      ["duplicate JSON keys", (value) => {
        value.response.rawBody = "{\"status\":\"ok\",\"status\":\"bad\"}";
      }, "control_response_bounds"],
      ["unknown response field", (value) => {
        value.response.parsed.unreviewed = true;
      }, "control_response_bounds"],
      ["unknown response enum", (value) => {
        value.response.parsed.status = "MYSTERY";
      }, "control_response_bounds"],
      ["secret-bearing error", (value) => {
        value.error = "TEST_ONLY_SECRET_MARKER";
      }, "control_transport"]
      ];
      for (const [name, mutate, code] of attacks) {
        const value = transportEvidence();
        mutate(value);
        assert.throws(
          () => validate(value),
          isObserverFailure(code),
          name
        );
      }
    });

    it("keeps response metadata strict and bounded", () => {
      assert.deepEqual(
        observer.validateStagingPhase1V2ControlResponseMetadataFixture({
          contentEncoding: undefined,
          contentLength: "128",
          contentType: "application/json",
          location: undefined,
          maximumBytes: 16 * 1024,
          serverDate: new Date().toUTCString(),
          statusCode: 200
        }).statusCode,
        200
      );
    });
  });

  describe("factory and admission", () => {
    it("keeps the reviewed production factory module-private", () => {
      assert.equal(
        Object.hasOwn(
          observer,
          "STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY"
        ),
        false
      );
    });

    it("exports no generic production registration, transport or signer", () => {
      const forbidden = Object.keys(observer).filter((name) =>
        /(register|setProduction|genericTransport|genericSigner|reseal)/i
          .test(name)
      );
      assert.deepEqual(forbidden, []);
    });

    it("uses the exact reviewed package identity and a literal source manifest", () => {
      const packageBinding =
        observer.STAGING_PHASE1_V2_PRODUCTION_OBSERVER_PACKAGE;
      assert.equal(
        packageBinding.packageId,
        "trailmind.production.staging-phase1-v2-observer"
      );
      assert.equal(packageBinding.trustMode, "production-authenticated-v1");
      assert.match(packageBinding.packageSourceDigest, /^[a-f0-9]{64}$/);
      assert.match(packageBinding.signingPublicKeyDigest, /^[a-f0-9]{64}$/);
      assert.equal(Object.isFrozen(packageBinding.sourceManifest), true);
      assert.deepEqual(
        [...packageBinding.sourceManifest].sort(),
        [
          "backend/package-lock.json",
          "backend/package.json",
          "backend/src/operations/stagingPhase1V2Admission.js",
          "backend/src/operations/stagingPhase1V2LiveLauncher.js",
          "backend/src/operations/stagingPhase1V2MachineObserver.js",
          "backend/src/operations/stagingPhase1V2Operator.js",
          "backend/src/operations/stagingPhase1V2SingleSessionAdapter.js"
        ].sort()
      );
    });

    it("does not calculate an expected package digest from runtime source", () => {
      const initialization = sourceBetween(
        OBSERVER_SOURCE,
        "const PRODUCTION_SOURCE_DIGEST",
        "const MAXIMUM_ARTIFACT_BYTES"
      );
      assert.equal(
        /readFileSync\s*\(/.test(initialization),
        false,
        "expected package digest must be a reviewed literal"
      );
      assert.equal(
        /import\.meta\.url/.test(initialization),
        false,
        "runtime source location cannot define the expected digest"
      );
    });

    it("rejects missing, copied, synthetic and manually constructed factories", () => {
      assert.throws(
        () => observer.requireReviewedStagingPhase1V2ProductionObserverFactory(),
        isObserverFailure("observer_required")
      );
      const synthetic =
        observer.createSyntheticStagingPhase1V2ObserverFactory();
      for (const candidate of [
        {},
        synthetic,
        { packageBinding: synthetic.packageBinding },
        {
          ...observer.STAGING_PHASE1_V2_REVIEWED_PRODUCTION_OBSERVER_FACTORY
        }
      ]) {
        assert.throws(
          () => observer
            .requireReviewedStagingPhase1V2ProductionObserverFactory(candidate),
          isObserverFailure("observer_untrusted")
        );
      }
    });

    it("rejects manual and copied artifacts at reviewed consumers", () => {
      const artifact = {
        artifactDigest: "0".repeat(64),
        evidence: {},
        phase: "pre-control"
      };
      assert.throws(
        () => observer.machineControlSnapshot(artifact),
        isObserverFailure("artifact_untrusted")
      );
    });

    it("completes pre-control before authorization, CA or database mutation", () => {
      const preControl = LAUNCHER_SOURCE.indexOf(
        "prepareStagingPhase1V2ProductionPreControl"
      );
      const inspectCa = LAUNCHER_SOURCE.indexOf(
        "const ca = inspectCertificateAuthority"
      );
      const authorization = LAUNCHER_SOURCE.indexOf(
        "await collectActionAuthorization"
      );
      const adapter = LAUNCHER_SOURCE.indexOf(
        "const result = await runAuthorizedStagingPhase1V2SingleSession"
      );
      assert.ok(preControl >= 0);
      assert.ok(preControl < inspectCa);
      assert.ok(preControl < authorization);
      assert.ok(preControl < adapter);
    });

  });
});

function parseAdvisorForAdmission(kind, value) {
  try {
    const result = observer.validateStagingPhase1V2ControlResponseFixture(
      kind,
      value
    );
    return {
      blocked: result.blockingFindingCount > 0,
      noticeCount: result.noticeCount
    };
  } catch (error) {
    if (error instanceof observer.StagingPhase1V2MachineObserverError) {
      return { blocked: true, noticeCount: 0 };
    }
    throw error;
  }
}

function advisorResponse({ level, category }) {
  return {
    lints: [{
      cache_key: `${category.toLowerCase()}-acceptance-1`,
      categories: [category],
      description: "bounded synthetic advisor fixture",
      detail: "bounded synthetic advisor fixture",
      facing: "EXTERNAL",
      level,
      metadata: { schema: "fixture", type: "table" },
      name: "acceptance_fixture",
      remediation: "review the synthetic fixture",
      title: "Synthetic acceptance fixture"
    }]
  };
}

function billingEvidence() {
  return {
    schemaVersion: 1,
    provider: "supabase-management-api",
    method: "GET",
    host: "api.supabase.com",
    path: `/v1/projects/${PROJECT}/billing/addons`,
    projectRef: PROJECT,
    permission: "infra_add_ons_read",
    responseDigest: "c".repeat(64),
    selectedAddons: [{
      type: "compute_instance",
      variant: {
        id: "ci_nano",
        price: {
          amount: 0,
          currency: "USD",
          interval: "monthly",
          type: "fixed"
        }
      }
    }],
    derived: {
      currency: "USD",
      monthlyCostAmount: 0,
      nonzeroAddonCount: 0
    }
  };
}

function advisorFreshnessEvidence() {
  return {
    schemaVersion: 1,
    endpointLifecycle: "deprecated-experimental",
    ddlCommittedAt: ADVISOR_COMMIT_TIME,
    ddlEvidenceDigest: "d".repeat(64),
    requestStartedAt: ADVISOR_OBSERVED_TIME,
    responseDigest: "e".repeat(64),
    providerRecomputation: {
      marker: "fixture-recomputation-1",
      completedAt: ADVISOR_OBSERVED_TIME,
      ddlEvidenceDigest: "d".repeat(64),
      source: "provider"
    }
  };
}

function dedicatedAuditorIdentity() {
  const applicationName = "trailmind_p1v2_auditor_0123456789abcdef01234567";
  return {
    applicationName,
    backendPid: undefined,
    clientPid: 51_241,
    row: {
      application_name: applicationName,
      backend_pid: 51_241,
      can_read_all_settings: false,
      can_read_all_stats: true,
      credential_distinct_from_mutator: true,
      current_user: "trailmind_phase1_v2_observer_auditor",
      database_name: "postgres",
      idle_timeout: "5s",
      is_superuser: "off",
      lock_timeout: "1s",
      memberships: [{
        admin: false,
        inherit: false,
        role: "pg_read_all_stats",
        set: true
      }],
      pool_mode: "session",
      product_data_grants: [],
      rolbypassrls: false,
      rolcanlogin: true,
      rolconnlimit: 1,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolsuper: false,
      search_path: "pg_catalog",
      server_version_num: 170_004,
      session_user: "trailmind_phase1_v2_observer_auditor",
      statement_timeout: "5s",
      tls: true,
      transaction_read_only: "on"
    }
  };
}

function candidatePostgresAuditorIdentity() {
  const applicationName = "trailmind_p1v2_auditor_fixture";
  return {
    applicationName,
    backendPid: undefined,
    clientPid: 51_241,
    row: {
      application_name: applicationName,
      backend_pid: 51_241,
      can_read_all_settings: true,
      can_read_all_stats: true,
      current_user: "postgres",
      database_name: "postgres",
      is_superuser: "off",
      no_advisory_locks: true,
      postgres_cannot_set_supabase_admin: true,
      rolbypassrls: false,
      rolcanlogin: true,
      rolcreatedb: true,
      rolcreaterole: true,
      rolreplication: false,
      rolsuper: false,
      server_version_num: 170_004,
      session_user: "postgres",
      shared_preload_libraries: "supautils, pg_stat_statements",
      supabase_admin_superuser: true,
      supautils_legacy_superuser: null,
      supautils_privileged_extensions: "postgis",
      supautils_privileged_role: "postgres",
      supautils_superuser: "supabase_admin",
      transaction_read_only: "on"
    }
  };
}

function mutatorBinding() {
  return {
    authorizationBindingDigest: AUTHORIZATION_DIGEST,
    candidateCommit: CANDIDATE,
    projectRef: PROJECT,
    runId: RUN
  };
}

function cleanupEvidence() {
  const applicationName =
    `trailmind_p1v2_${sha256(canonicalJson(mutatorBinding())).slice(0, 24)}`;
  const target = {
    applicationName,
    backendPid: 41_241,
    backendStart: "2026-08-30T09:59:00.000Z",
    disconnectConfirmedAt: "2026-08-30T10:00:00.500Z",
    runId: RUN
  };
  const sample = (sequence, observedAt, snapshotId) => ({
    sequence,
    observedAt,
    snapshotId,
    freshTransaction: true,
    statsSnapshotCleared: true,
    visibilityContractVerified: true,
    reconnectDetected: false,
    applicationName,
    backendPid: target.backendPid,
    backendStart: target.backendStart,
    runId: RUN,
    exactBackendInstanceCount: 0,
    matchingApplicationCount: 0,
    activeSessionCount: 0,
    idleExactInstanceCount: 0
  });
  return {
    schemaVersion: 1,
    target,
    samples: [
      sample(1, "2026-08-30T10:00:01.000Z", randomUUID()),
      sample(2, "2026-08-30T10:00:01.300Z", randomUUID())
    ],
    publicationEligibleAt: "2026-08-30T10:00:01.400Z"
  };
}

function signedArtifactChain({
  expectedBinding = artifactBinding(),
  keyPair = ACCEPTANCE_KEYS,
  trustAnchorMode = "offline-ephemeral-fixture"
} = {}) {
  const publicKeyDer = keyPair.publicKey.export({ format: "der", type: "spki" });
  const publicKeyDigest = sha256(publicKeyDer);
  const artifacts = [];
  let previousArtifactDigest = null;
  for (const [index, phase] of ARTIFACT_PHASES.entries()) {
    const unsigned = {
      schemaVersion: 2,
      contractId: "trailmind-production-observer-acceptance-v1",
      binding: structuredClone(expectedBinding),
      phase,
      sequence: index + 1,
      observationId: `00000000-0000-4000-8000-00000000000${index + 1}`,
      observedAt: `2026-08-30T10:00:0${index}.000Z`,
      previousArtifactDigest,
      session: phase === "pre-control" ? {
        applicationName: null,
        backendPid: null,
        backendStart: null
      } : {
        applicationName: cleanupEvidence().target.applicationName,
        backendPid: 41_241,
        backendStart: "2026-08-30T09:59:00.000Z"
      },
      evidence: artifactEvidence(phase)
    };
    const artifactDigest = sha256(canonicalJson(unsigned));
    const signatureValue = sign(
      null,
      Buffer.from(`${ARTIFACT_DOMAIN}\u0000${artifactDigest}`, "utf8"),
      keyPair.privateKey
    );
    artifacts.push({
      ...unsigned,
      artifactDigest,
      signature: {
        algorithm: "Ed25519",
        publicKeyDigest,
        valueBase64: signatureValue.toString("base64")
      }
    });
    previousArtifactDigest = artifactDigest;
  }
  return {
    schemaVersion: 1,
    expectedBinding: structuredClone(expectedBinding),
    trustAnchor: {
      mode: trustAnchorMode,
      publicKeyDerBase64: publicKeyDer.toString("base64"),
      publicKeyDigest
    },
    artifacts,
    persistence: ARTIFACT_PHASES.map((phase, index) => ({
      sequence: index + 1,
      phase,
      createdExclusively: true,
      noFollow: true,
      mode: "0600",
      fileFsync: true,
      directoryFsync: true
    })),
    terminalPublication: {
      allArtifactsExisted: true,
      allArtifactsVerified: true,
      descriptorsClosed: true,
      secretBuffersWiped: true,
      targetDisconnected: true,
      auditorClosedAfterProof: true
    }
  };
}

function artifactBinding() {
  return {
    attemptId: ATTEMPT,
    runId: RUN,
    authorizationBindingDigest: AUTHORIZATION_DIGEST,
    candidateCommit: CANDIDATE,
    candidateTree: TREE,
    operatorDigestsDigest: OPERATOR_DIGEST,
    projectRef: PROJECT,
    organizationId: ORGANIZATION,
    region: REGION,
    databaseRunBindingDigest: sha256(canonicalJson(mutatorBinding()))
  };
}

function artifactEvidence(phase) {
  if (phase === "pre-control") {
    return {
      billing: billingEvidence(),
      advisorBlockingCount: 0,
      providerFreshnessRequired: true
    };
  }
  if (phase === "post-ddl-advisors") {
    return { freshness: advisorFreshnessEvidence(), blockingCount: 0 };
  }
  if (phase === "final-control") {
    return {
      exactTargetSessionCount: 1,
      siblingSessionCount: 0,
      auditorContract: "dedicated-least-privilege-v1"
    };
  }
  return { cleanupSamples: cleanupEvidence().samples };
}

function referenceValidateSignedChain(value) {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.trustAnchor.mode, "offline-ephemeral-fixture");
  const keyDer = Buffer.from(value.trustAnchor.publicKeyDerBase64, "base64");
  assert.equal(sha256(keyDer), value.trustAnchor.publicKeyDigest);
  assert.equal(value.artifacts.length, 4);
  assert.equal(value.persistence.length, 4);
  const phases = new Set();
  const digests = new Set();
  let previous = null;
  for (const [index, artifact] of value.artifacts.entries()) {
    assert.equal(artifact.phase, ARTIFACT_PHASES[index]);
    assert.equal(artifact.sequence, index + 1);
    assert.equal(artifact.previousArtifactDigest, previous);
    assert.deepEqual(artifact.binding, value.expectedBinding);
    assert.equal(phases.has(artifact.phase), false);
    assert.equal(digests.has(artifact.artifactDigest), false);
    phases.add(artifact.phase);
    digests.add(artifact.artifactDigest);
    const { artifactDigest, signature: signatureValue, ...unsigned } = artifact;
    assert.equal(sha256(canonicalJson(unsigned)), artifactDigest);
    assert.equal(signatureValue.algorithm, "Ed25519");
    assert.equal(
      signatureValue.publicKeyDigest,
      value.trustAnchor.publicKeyDigest
    );
    assert.equal(verify(
      null,
      Buffer.from(`${ARTIFACT_DOMAIN}\u0000${artifactDigest}`, "utf8"),
      { format: "der", key: keyDer, type: "spki" },
      Buffer.from(signatureValue.valueBase64, "base64")
    ), true);
    const persisted = value.persistence[index];
    assert.equal(persisted.sequence, index + 1);
    assert.equal(persisted.phase, artifact.phase);
    assert.equal(persisted.createdExclusively, true);
    assert.equal(persisted.noFollow, true);
    assert.equal(persisted.mode, "0600");
    assert.equal(persisted.fileFsync, true);
    assert.equal(persisted.directoryFsync, true);
    previous = artifactDigest;
  }
  assert.deepEqual(value.terminalPublication, {
    allArtifactsExisted: true,
    allArtifactsVerified: true,
    descriptorsClosed: true,
    secretBuffersWiped: true,
    targetDisconnected: true,
    auditorClosedAfterProof: true
  });
  return { accepted: true };
}

function oauthAccessToken() {
  return jwt({
    aud: "supabase-management-api",
    exp: 1_900_000_000,
    scope: "database:read organizations:read projects:read",
    token_use: "access"
  });
}

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }))
      .toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "x".repeat(64)
  ].join(".");
}

function descriptorLifecycle() {
  return {
    schemaVersion: 1,
    fd: 7,
    regularFile: true,
    ownerUidMatches: true,
    mode: "0600",
    linkCount: 0,
    offset: 0,
    closeOnExec: true,
    distinctDeviceAndInode: true,
    readCount: 1,
    unlinkedBeforeNetwork: true,
    success: { closed: true, wiped: true },
    failure: { closed: true, wiped: true },
    cancellation: { closed: true, wiped: true }
  };
}

function transportEvidence() {
  return {
    schemaVersion: 1,
    request: {
      ordinal: 1,
      attempt: 1,
      method: "GET",
      protocol: "https:",
      host: "api.supabase.com",
      port: 443,
      path: `/v1/projects/${PROJECT}`,
      projectRef: PROJECT,
      requestBodyBytes: 0,
      proxyUsed: false
    },
    dns: {
      startAddresses: ["104.18.38.10"],
      endAddresses: ["104.18.38.10"]
    },
    tls: {
      authorized: true,
      hostnameVerified: true,
      protocol: "TLSv1.3",
      servername: "api.supabase.com"
    },
    response: {
      statusCode: 200,
      contentType: "application/json",
      contentEncoding: undefined,
      byteLength: 42,
      rawBody: JSON.stringify({ status: "ACTIVE_HEALTHY" }),
      parsed: { status: "ACTIVE_HEALTHY" }
    },
    error: null
  };
}

function binding(runId = RUN) {
  return {
    attemptId: ATTEMPT,
    candidateCommit: CANDIDATE,
    candidateTree: TREE,
    organizationId: ORGANIZATION,
    projectRef: PROJECT,
    region: REGION,
    runId
  };
}

function phaseRequest(phase) {
  return {
    applicationName: null,
    authorizationBindingDigest: null,
    backendPid: null,
    phase,
    stagedReceiptDigest: null
  };
}

function unlinkedDescriptor(contents, { advanceOffset = false } = {}) {
  const directory = mkdtempSync(
    "/private/tmp/trailmind-observer-security-descriptor."
  );
  const path = join(directory, "credential");
  let writer = openSync(path, "wx+", 0o600);
  chmodSync(path, 0o600);
  const bytes = Buffer.from(contents, "utf8");
  writeSync(writer, bytes, 0, bytes.length, null);
  bytes.fill(0);
  closeSync(writer);
  writer = undefined;
  const fd = openSync(path, "r");
  unlinkSync(path);
  if (advanceOffset) readSync(fd, Buffer.alloc(1), 0, 1, null);
  return {
    fd,
    dispose() {
      try { closeSync(fd); } catch { /* production may own and close it */ }
      rmSync(directory, { force: true, recursive: true });
    }
  };
}

function fixtureMethod(name) {
  const seam = observer[FIXTURE_SEAM];
  assert.ok(seam && typeof seam === "object",
    `missing immutable ${FIXTURE_SEAM}`);
  assert.equal(Object.isFrozen(seam), true,
    `${FIXTURE_SEAM} must be immutable`);
  assert.equal(typeof seam[name], "function",
    `missing immutable security fixture seam ${name}`);
  return seam[name];
}

function isObserverFailure(code) {
  return (error) => error instanceof observer.StagingPhase1V2MachineObserverError &&
    (code === undefined || error.code === code) &&
    !/TEST_ONLY_SECRET_MARKER|sbp_|oauth_refresh|client_secret/i
      .test(error.message);
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing static contract marker ${start}`);
  assert.ok(endIndex > startIndex, `missing static contract marker ${end}`);
  return source.slice(startIndex, endIndex);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
