const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");

const DATABASE_NAME = "factbase_rcv017_phase3_20260831_01";
const enabled = process.env.RCV017_PHASE3_DATABASE === DATABASE_NAME;
const pool = enabled
  ? new Pool({ database: DATABASE_NAME, host: "/private/tmp", max: 4 })
  : null;

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function id(number) {
  return `10000000-0000-0000-0000-${number.toString(16).padStart(12, "0")}`;
}

const TS = "2026-08-31T10:00:00.000000Z";
const EMPTY = "{}";
const EMPTY_HASH = hash(EMPTY);
const SNAPSHOT_ID = id(900);
const CLAIM_VERSION_ID = id(11);
const POLICY_ID = id(700);
const RELATION_IDS = [id(101), id(102), id(103), id(104)];
const EVIDENCE_IDS = [id(201), id(202), id(203), id(204)];
const ARTIFACT_VERSION_IDS = [id(301), id(302), id(303), id(304)];
const BINDING_IDS = [id(401), id(402), id(403), id(404)];
const PROVENANCE_IDS = [id(501), id(502)];
const KNOWLEDGE_IDS = [id(601), id(602)];

async function installBaseFixtures() {
  const installed = await pool.query(
    "SELECT EXISTS (SELECT 1 FROM public.claim_versions WHERE id=$1) AS installed",
    [CLAIM_VERSION_ID],
  );
  if (installed.rows[0].installed) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO public.claims (id) VALUES ($1)", [id(10)]);
    await client.query(
      `INSERT INTO public.claim_versions
        (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at)
       VALUES ($1,$2,1,'phase3','phase3','en','fact','active','published','fixture',$3)`,
      [CLAIM_VERSION_ID, id(10), TS],
    );
    for (let index = 0; index < EVIDENCE_IDS.length; index += 1) {
      await client.query(
        "INSERT INTO public.evidence (id,retrieved_at,created_at) VALUES ($1,$2,$2)",
        [EVIDENCE_IDS[index], TS],
      );
      await client.query(
        `INSERT INTO public.claim_version_evidence
          (id,claim_version_id,evidence_id,relation,created_at)
         VALUES ($1,$2,$3,'supports',$4)`,
        [RELATION_IDS[index], CLAIM_VERSION_ID, EVIDENCE_IDS[index], TS],
      );
    }
    await client.query(
      `INSERT INTO public.provenance_payload_limits (
        limits_id,limits_version,schema_id,schema_version,
        source_metadata_canonical_bytes,source_locator_count,
        display_name_codepoints,display_name_utf8_bytes,
        locator_string_codepoints,locator_string_utf8_bytes,
        artifact_capture_canonical_bytes,artifact_locator_codepoints,
        artifact_locator_utf8_bytes,media_type_codepoints,media_type_utf8_bytes,
        title_codepoints,title_utf8_bytes,rationale_codepoints,rationale_utf8_bytes,
        foundation_canonical_bytes,foundation_item_count,
        foundation_input_reference_count,foundation_reference_codepoints,
        foundation_reference_utf8_bytes,definition_canonical,definition_hash
      ) VALUES ('rcv017-phase3','1','factbase-provenance-payload-limits','1',
        10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,
        10000,10000,10000,10000,10000,10000,10000,10000,10000,10000,$1,$2)`,
      [EMPTY, EMPTY_HASH],
    );
    await client.query(
      `INSERT INTO public.provenance_traversal_policies (
        policy_id,policy_version,schema_id,schema_version,definition_canonical,
        definition_hash,max_roots,max_nodes,max_edges,max_depth,
        max_canonical_snapshot_bytes,allowed_relationships,
        deterministic_ordering,visited_semantics
      ) VALUES ('rcv017-phase3','1','factbase-provenance-traversal-policy','1',$1,$2,
        10,100,100,10,1000000,
        ARRAY['cites','derived_from','incorporates','quotes','reposts','syndicated_from','uses_information_from'],
        'schema_category_then_canonical_key_lexicographic_v1',
        'expand_node_once_include_statement_once_diagnose_cycles_v1')`,
      [EMPTY, EMPTY_HASH],
    );
    for (let index = 0; index < ARTIFACT_VERSION_IDS.length; index += 1) {
      await client.query("INSERT INTO public.provenance_artifacts (id) VALUES ($1)", [id(350 + index)]);
      await client.query(
        `INSERT INTO public.provenance_artifact_versions
          (id,artifact_id,version_number,capture_schema_id,capture_schema_version,
           capture_canonical,capture_hash,payload_limits_id,payload_limits_version)
         VALUES ($1,$2,1,'factbase-artifact-version-capture','1',$3,$4,'rcv017-phase3','1')`,
        [ARTIFACT_VERSION_IDS[index], id(350 + index), EMPTY, EMPTY_HASH],
      );
    }
    await client.query(
      `INSERT INTO public.artifact_provenance_statements
        (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,
         observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'quotes',$3,$4,'rcv017-phase3','1'),
              ($5,$6,'quotes',$3,$4,'rcv017-phase3','1')`,
      [PROVENANCE_IDS[0], ARTIFACT_VERSION_IDS[0], ARTIFACT_VERSION_IDS[2], TS,
       PROVENANCE_IDS[1], ARTIFACT_VERSION_IDS[1]],
    );
    for (let index = 0; index < BINDING_IDS.length; index += 1) {
      const artifactVersionId = index === 2 ? ARTIFACT_VERSION_IDS[0] : ARTIFACT_VERSION_IDS[index];
      await client.query(
        `INSERT INTO public.evidence_artifact_bindings
          (id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version)
         VALUES ($1,$2,$3,$4,'rcv017-phase3','1')`,
        [BINDING_IDS[index], EVIDENCE_IDS[index], artifactVersionId, TS],
      );
    }
    await client.query(
      `INSERT INTO public.knowledge_state_statements
        (id,artifact_version_id,scope,state,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'upstream_provenance','unknown',$3,'rcv017-phase3','1'),
              ($4,$5,'upstream_provenance','known',$3,'rcv017-phase3','1')`,
      [KNOWLEDGE_IDS[0], ARTIFACT_VERSION_IDS[0], TS, KNOWLEDGE_IDS[1], ARTIFACT_VERSION_IDS[1]],
    );
    await client.query(
      `INSERT INTO public.provenance_snapshots (
        id,snapshot_schema_id,snapshot_schema_version,builder_id,builder_version,
        builder_artifact_hash,canonicalization_id,canonicalization_version,hash_algorithm,
        policy_id,policy_version,definition_hash,max_roots,max_nodes,max_edges,max_depth,
        max_canonical_snapshot_bytes,allowed_relationships,deterministic_ordering,
        visited_semantics,snapshot_canonical,snapshot_hash
      ) VALUES ($1,'factbase-provenance-snapshot','1',
        'factbase-provenance-snapshot-builder','1',$2,'jcs-rfc8785','1','sha-256',
        'rcv017-phase3','1',$3,10,100,100,10,1000000,
        ARRAY['cites','derived_from','incorporates','quotes','reposts','syndicated_from','uses_information_from'],
        'schema_category_then_canonical_key_lexicographic_v1',
        'expand_node_once_include_statement_once_diagnose_cycles_v1',$4,$3)`,
      [SNAPSHOT_ID, "a".repeat(64), EMPTY_HASH, EMPTY],
    );
    for (const artifactVersionId of ARTIFACT_VERSION_IDS) {
      await client.query(
        "INSERT INTO public.provenance_snapshot_artifact_versions (snapshot_id,artifact_version_id,membership_role) VALUES ($1,$2,'included')",
        [SNAPSHOT_ID, artifactVersionId],
      );
    }
    for (const statementId of PROVENANCE_IDS) {
      await client.query(
        "INSERT INTO public.provenance_snapshot_artifact_provenance_statements (snapshot_id,artifact_provenance_statement_id) VALUES ($1,$2)",
        [SNAPSHOT_ID, statementId],
      );
    }
    for (const bindingId of BINDING_IDS) {
      await client.query(
        "INSERT INTO public.provenance_snapshot_evidence_artifact_bindings (snapshot_id,evidence_artifact_binding_id) VALUES ($1,$2)",
        [SNAPSHOT_ID, bindingId],
      );
    }
    for (const statementId of KNOWLEDGE_IDS) {
      await client.query(
        "INSERT INTO public.provenance_snapshot_knowledge_state_statements (snapshot_id,knowledge_state_statement_id) VALUES ($1,$2)",
        [SNAPSHOT_ID, statementId],
      );
    }
    await insertPolicy(client, POLICY_ID, 1, EMPTY);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertPolicy(client, policyId, policyVersion, canonical) {
  const canonicalHash = hash(canonical);
  await client.query(
    `INSERT INTO public.dependency_analysis_policies (
      policy_id,policy_version,schema_id,schema_version,
      relationship_classification_catalog_id,relationship_classification_catalog_version,
      evidence_direction_partition_rule,reflexive_closure_rule,common_upstream_rule,
      negative_finding_rule,knowledge_limitation_rule,witness_selection_rule,
      finding_vocabulary_rule,cycle_handling_rule,deterministic_ordering_rule,
      max_evidence_relations,max_bindings,max_artifact_versions,max_statements,
      max_dependency_depth,max_findings,max_canonical_bytes,
      canonicalization_id,canonicalization_version,hash_algorithm,
      definition_canonical,definition_hash
    ) VALUES ($1,$2,'factbase-dependency-analysis-policy','1',
      'factbase-dependency-relationship-classification','1',
      'supports_and_contradicts_separate_contextualizes_excluded',
      'anchor_depth_zero_then_enabled_dependency_edges_minimum_distance',
      'same_exact_artifact_version_in_two_or_more_reflexive_branch_closures',
      'unordered_same_direction_pair_with_disjoint_reflexive_closures',
      'snapshot_unknown_partial_or_derived_unrecorded_in_reached_set',
      'fewest_edges_then_ascii_statement_id_sequence',
      'rcv017_closed_four_finding_vocabulary_v1',
      'expand_once_per_branch_at_minimum_distance','rcv017_explicit_total_order_v1',
      20,20,100,100,10,100,1000000,'jcs-rfc8785','1','sha-256',$3,$4)`,
    [policyId, policyVersion, canonical, canonicalHash],
  );
  await client.query(
    "INSERT INTO public.dependency_analysis_policy_relationships (policy_id,policy_version,relationship) VALUES ($1,$2,'quotes')",
    [policyId, policyVersion],
  );
  return canonicalHash;
}

async function insertAnalysisBundle(client, analysisId, options = {}) {
  const canonical = options.canonical ?? EMPTY;
  const snapshotId = options.snapshotId ?? SNAPSHOT_ID;
  const snapshotHash = options.snapshotHash ?? EMPTY_HASH;
  const policyId = options.policyId ?? POLICY_ID;
  const policyVersion = options.policyVersion ?? 1;
  const policyHash = options.policyHash ?? EMPTY_HASH;
  const count = options.bindingCount ?? 1;
  await client.query(
    `INSERT INTO public.claim_evidence_dependency_analyses (
      analysis_id,analysis_schema_id,analysis_schema_version,claim_version_id,
      provenance_snapshot_id,provenance_snapshot_hash,
      dependency_analysis_policy_id,dependency_analysis_policy_version,
      dependency_analysis_policy_hash,algorithm_id,algorithm_version,
      algorithm_artifact_hash,canonicalization_id,canonicalization_version,
      hash_algorithm,analysis_canonical,analysis_hash
    ) VALUES ($1,'factbase-claim-evidence-dependency-analysis','1',$2,$3,$4,$5,$6,$7,
      'factbase-claim-evidence-dependency-algorithm','1',$8,'jcs-rfc8785','1',
      'sha-256',$9,$10)`,
    [analysisId, options.claimVersionId ?? CLAIM_VERSION_ID, snapshotId, snapshotHash,
     policyId, policyVersion, policyHash, "b".repeat(64), canonical,
     options.analysisHash ?? hash(canonical)],
  );
  for (let index = 0; index < count; index += 1) {
    const artifactVersionId = index === 2 ? ARTIFACT_VERSION_IDS[0] : ARTIFACT_VERSION_IDS[index];
    await client.query(
      `INSERT INTO public.dependency_analysis_evidence_relations
        (analysis_id,claim_version_evidence_relation_id,evidence_id,direction)
       VALUES ($1,$2,$3,'supports')`,
      [analysisId, RELATION_IDS[index], options.relationEvidenceId ?? EVIDENCE_IDS[index]],
    );
    if (!options.omitBinding) {
      await client.query(
        `INSERT INTO public.dependency_analysis_bindings
          (analysis_id,provenance_snapshot_id,claim_version_evidence_relation_id,
           evidence_artifact_binding_statement_id,evidence_id,artifact_version_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [analysisId, snapshotId, RELATION_IDS[index],
         options.bindingStatementId ?? BINDING_IDS[index],
         options.bindingEvidenceId ?? EVIDENCE_IDS[index],
         options.bindingArtifactVersionId ?? artifactVersionId],
      );
    }
  }
}

async function expectTransactionFailure(work, pattern = /RCV-017|violates|duplicate|foreign key/i) {
  const client = await pool.connect();
  let failure;
  try {
    await client.query("BEGIN");
    try {
      await work(client);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "expected the physical attack to be rejected");
    assert.match(String(failure.message), pattern);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function insertSharedFinding(client, analysisId, { oneMember = false, wrongAnchor = false } = {}) {
  await client.query(
    "INSERT INTO public.dependency_analysis_shared_artifact_findings (analysis_id,direction,artifact_version_id) VALUES ($1,'supports',$2)",
    [analysisId, ARTIFACT_VERSION_IDS[0]],
  );
  await client.query(
    `INSERT INTO public.dependency_analysis_shared_artifact_members
      (analysis_id,direction,artifact_version_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
     VALUES ($1,'supports',$2,$3,$4)`,
    [analysisId, ARTIFACT_VERSION_IDS[0], RELATION_IDS[0], BINDING_IDS[0]],
  );
  if (!oneMember) {
    const index = wrongAnchor ? 1 : 2;
    await client.query(
      `INSERT INTO public.dependency_analysis_shared_artifact_members
        (analysis_id,direction,artifact_version_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
       VALUES ($1,'supports',$2,$3,$4)`,
      [analysisId, ARTIFACT_VERSION_IDS[0], RELATION_IDS[index], BINDING_IDS[index]],
    );
  }
}

async function insertCommonFinding(client, analysisId, mutation = {}) {
  await client.query(
    "INSERT INTO public.dependency_analysis_common_upstream_findings (analysis_id,direction,upstream_artifact_version_id) VALUES ($1,'supports',$2)",
    [analysisId, ARTIFACT_VERSION_IDS[2]],
  );
  const memberCount = mutation.oneMember ? 1 : 2;
  for (let index = 0; index < memberCount; index += 1) {
    await client.query(
      `INSERT INTO public.dependency_analysis_common_upstream_members
        (analysis_id,direction,upstream_artifact_version_id,
         claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
       VALUES ($1,'supports',$2,$3,$4)`,
      [analysisId, ARTIFACT_VERSION_IDS[2], RELATION_IDS[index], BINDING_IDS[index]],
    );
    const start = mutation.wrongStart && index === 0
      ? ARTIFACT_VERSION_IDS[3]
      : ARTIFACT_VERSION_IDS[index];
    const end = mutation.wrongEnd && index === 0
      ? ARTIFACT_VERSION_IDS[3]
      : ARTIFACT_VERSION_IDS[2];
    const statement = mutation.foreignStatement && index === 0
      ? id(599)
      : PROVENANCE_IDS[index];
    await client.query(
      `INSERT INTO public.dependency_analysis_common_upstream_witness_steps
        (analysis_id,provenance_snapshot_id,direction,upstream_artifact_version_id,
         claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,
         ordinal,artifact_version_id,artifact_provenance_statement_id)
       VALUES ($1,$2,'supports',$3,$4,$5,0,$6,$7),
              ($1,$2,'supports',$3,$4,$5,1,$8,NULL)`,
      [analysisId, SNAPSHOT_ID, ARTIFACT_VERSION_IDS[2], RELATION_IDS[index],
       BINDING_IDS[index], start, statement, end],
    );
  }
}

test.before(async () => {
  if (enabled) await installBaseFixtures();
});

test("RCV-017 physical migration catalog matches the frozen inventory", { skip: !enabled }, async () => {
  const identity = await pool.query(
    "SELECT current_database() AS database, current_setting('server_version_num')::integer / 10000 AS major, current_setting('server_encoding') AS encoding, inet_server_addr() IS NULL AS local_socket",
  );
  assert.deepEqual(identity.rows[0], {
    database: DATABASE_NAME,
    major: 16,
    encoding: "UTF8",
    local_socket: true,
  });

  const inventory = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'dependency_analysis_%'
           OR n.nspname='public' AND c.relkind='r' AND c.relname='claim_evidence_dependency_analyses') AS tables,
      (SELECT count(*)::integer FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND (t.relname LIKE 'dependency_analysis_%' OR t.relname='claim_evidence_dependency_analyses') AND c.contype='p') AS pks,
      (SELECT count(*)::integer FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND (t.relname LIKE 'dependency_analysis_%' OR t.relname='claim_evidence_dependency_analyses') AND c.contype='u') AS uniques,
      (SELECT count(*)::integer FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND (t.relname LIKE 'dependency_analysis_%' OR t.relname='claim_evidence_dependency_analyses') AND c.contype='f') AS fks,
      (SELECT count(*)::integer FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND (t.relname LIKE 'dependency_analysis_%' OR t.relname='claim_evidence_dependency_analyses') AND c.contype='c') AS checks,
      (SELECT count(*)::integer FROM pg_trigger WHERE tgname LIKE 'trg_rcv017_%' AND NOT tgisinternal) AS triggers,
      (SELECT count(*)::integer FROM pg_trigger WHERE tgname LIKE 'trg_rcv017_guard_%' AND NOT tgisinternal) AS append_triggers,
      (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname LIKE 'rcv017_%') AS functions
  `);
  assert.deepEqual(inventory.rows[0], {
    tables: 15,
    pks: 15,
    uniques: 3,
    fks: 39,
    checks: 13,
    triggers: 30,
    append_triggers: 15,
    functions: 3,
  });
});

test("RCV-017 all physical foreign keys are NO ACTION", { skip: !enabled }, async () => {
  const result = await pool.query(`
    SELECT confdeltype, confupdtype, count(*)::integer AS count
    FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public'
      AND (t.relname LIKE 'dependency_analysis_%' OR t.relname='claim_evidence_dependency_analyses')
      AND c.contype='f'
    GROUP BY confdeltype, confupdtype
  `);
  assert.deepEqual(result.rows, [{ confdeltype: "a", confupdtype: "a", count: 39 }]);
});

test("RCV-017 exact TEXT byte/hash boundary preserves escaped NUL distinctions and permits matching-hash non-JCS", { skip: !enabled }, async () => {
  const logicalNulCanonical = '{"value":"\\u0000"}';
  const literalEscapeCanonical = '{"value":"\\\\u0000"}';
  const nonJcs = '{ "value" : 1 }';
  assert.notEqual(logicalNulCanonical, literalEscapeCanonical);
  assert.notEqual(hash(logicalNulCanonical), hash(literalEscapeCanonical));
  assert.equal(Buffer.from(logicalNulCanonical).includes(0), false);
  assert.equal(Buffer.from(literalEscapeCanonical).includes(0), false);

  // Full fixture insertion and the remaining physical attack matrix are below;
  // this assertion is intentionally against PostgreSQL's byte/hash boundary,
  // not an RFC-8785/JCS claim.
  const result = await pool.query(
    "SELECT public.rcv016_sha256_text($1::text) AS hash, $1::text AS exact",
    [nonJcs],
  );
  assert.deepEqual(result.rows[0], { hash: hash(nonJcs), exact: nonJcs });
});

test("RCV-017 commits one complete typed analysis aggregate atomically", { skip: !enabled }, async () => {
  const analysisId = id(810);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertAnalysisBundle(client, analysisId, { bindingCount: 4 });
    await insertSharedFinding(client, analysisId);
    await insertCommonFinding(client, analysisId);
    await client.query(
      `INSERT INTO public.dependency_analysis_no_common_upstream_findings
        (analysis_id,direction,lower_claim_version_evidence_relation_id,
         lower_evidence_artifact_binding_statement_id,
         upper_claim_version_evidence_relation_id,
         upper_evidence_artifact_binding_statement_id)
       VALUES ($1,'supports',$2,$3,$4,$5)`,
      [analysisId, RELATION_IDS[0], BINDING_IDS[0], RELATION_IDS[3], BINDING_IDS[3]],
    );
    await client.query(
      `INSERT INTO public.dependency_analysis_knowledge_incomplete_findings
        (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
       VALUES ($1,$2,$3)`,
      [analysisId, RELATION_IDS[0], BINDING_IDS[0]],
    );
    await client.query(
      `INSERT INTO public.dependency_analysis_knowledge_affected_artifacts
        (analysis_id,claim_version_evidence_relation_id,
         evidence_artifact_binding_statement_id,artifact_version_id)
       VALUES ($1,$2,$3,$4)`,
      [analysisId, RELATION_IDS[0], BINDING_IDS[0], ARTIFACT_VERSION_IDS[0]],
    );
    await client.query(
      `INSERT INTO public.dependency_analysis_knowledge_state_evidence
        (analysis_id,provenance_snapshot_id,claim_version_evidence_relation_id,
         evidence_artifact_binding_statement_id,knowledge_state_statement_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [analysisId, SNAPSHOT_ID, RELATION_IDS[0], BINDING_IDS[0], KNOWLEDGE_IDS[0]],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const counts = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1) AS header,
      (SELECT count(*)::integer FROM public.dependency_analysis_evidence_relations WHERE analysis_id=$1) AS relations,
      (SELECT count(*)::integer FROM public.dependency_analysis_bindings WHERE analysis_id=$1) AS bindings,
      (SELECT count(*)::integer FROM public.dependency_analysis_shared_artifact_findings WHERE analysis_id=$1) AS shared_findings,
      (SELECT count(*)::integer FROM public.dependency_analysis_shared_artifact_members WHERE analysis_id=$1) AS shared_members,
      (SELECT count(*)::integer FROM public.dependency_analysis_common_upstream_findings WHERE analysis_id=$1) AS common_findings,
      (SELECT count(*)::integer FROM public.dependency_analysis_common_upstream_members WHERE analysis_id=$1) AS common_members,
      (SELECT count(*)::integer FROM public.dependency_analysis_common_upstream_witness_steps WHERE analysis_id=$1) AS witness_steps,
      (SELECT count(*)::integer FROM public.dependency_analysis_no_common_upstream_findings WHERE analysis_id=$1) AS negative_findings,
      (SELECT count(*)::integer FROM public.dependency_analysis_knowledge_incomplete_findings WHERE analysis_id=$1) AS knowledge_findings,
      (SELECT count(*)::integer FROM public.dependency_analysis_knowledge_affected_artifacts WHERE analysis_id=$1) AS affected,
      (SELECT count(*)::integer FROM public.dependency_analysis_knowledge_state_evidence WHERE analysis_id=$1) AS knowledge_evidence,
      (SELECT analysis_canonical FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1) AS canonical,
      (SELECT analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1) AS hash
  `, [analysisId]);
  assert.deepEqual(counts.rows[0], {
    header: 1, relations: 4, bindings: 4,
    shared_findings: 1, shared_members: 2,
    common_findings: 1, common_members: 2, witness_steps: 4,
    negative_findings: 1, knowledge_findings: 1, affected: 1,
    knowledge_evidence: 1, canonical: EMPTY, hash: EMPTY_HASH,
  });
});

test("RCV-017 policy and exact binding attacks fail closed", { skip: !enabled }, async (t) => {
  await t.test("attack 1 unknown policy relationship", async () => {
    await expectTransactionFailure(async (client) => {
      const policyId = id(701);
      await insertPolicy(client, policyId, 1, EMPTY);
      await client.query(
        "INSERT INTO public.dependency_analysis_policy_relationships VALUES ($1,1,'unknown',DEFAULT)",
        [policyId],
      );
    });
  });
  await t.test("attack 2 cites cannot be enabled", async () => {
    await expectTransactionFailure(async (client) => {
      const policyId = id(702);
      await insertPolicy(client, policyId, 1, EMPTY);
      await client.query(
        "INSERT INTO public.dependency_analysis_policy_relationships VALUES ($1,1,'cites',DEFAULT)",
        [policyId],
      );
    });
  });
  await t.test("attack 3 duplicate enabled relationship", async () => {
    await expectTransactionFailure(async (client) => {
      const policyId = id(703);
      await insertPolicy(client, policyId, 1, EMPTY);
      await client.query(
        "INSERT INTO public.dependency_analysis_policy_relationships (policy_id,policy_version,relationship) VALUES ($1,1,'quotes')",
        [policyId],
      );
    });
  });
  await t.test("attack 4 policy hash mismatch", async () => {
    await expectTransactionFailure(async (client) => {
      await client.query(
        `INSERT INTO public.dependency_analysis_policies (
          policy_id,policy_version,schema_id,schema_version,
          relationship_classification_catalog_id,relationship_classification_catalog_version,
          evidence_direction_partition_rule,reflexive_closure_rule,common_upstream_rule,
          negative_finding_rule,knowledge_limitation_rule,witness_selection_rule,
          finding_vocabulary_rule,cycle_handling_rule,deterministic_ordering_rule,
          max_evidence_relations,max_bindings,max_artifact_versions,max_statements,
          max_dependency_depth,max_findings,max_canonical_bytes,
          canonicalization_id,canonicalization_version,hash_algorithm,
          definition_canonical,definition_hash)
         SELECT $1,2,schema_id,schema_version,relationship_classification_catalog_id,
          relationship_classification_catalog_version,evidence_direction_partition_rule,
          reflexive_closure_rule,common_upstream_rule,negative_finding_rule,
          knowledge_limitation_rule,witness_selection_rule,finding_vocabulary_rule,
          cycle_handling_rule,deterministic_ordering_rule,max_evidence_relations,
          max_bindings,max_artifact_versions,max_statements,max_dependency_depth,
          max_findings,max_canonical_bytes,canonicalization_id,
          canonicalization_version,hash_algorithm,definition_canonical,$2
         FROM public.dependency_analysis_policies WHERE policy_id=$3 AND policy_version=1`,
        [id(704), "f".repeat(64), POLICY_ID],
      );
    });
  });
  await t.test("attack 5 analysis hash mismatch", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(801), { analysisHash: "f".repeat(64) }));
  });
  await t.test("attack 6 exact Snapshot hash mismatch", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(802), { snapshotHash: "f".repeat(64) }));
  });
  await t.test("attack 7 exact Policy hash mismatch", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(803), { policyHash: "f".repeat(64) }));
  });
  await t.test("attack 8 relation ClaimVersion mismatch", async () => {
    await expectTransactionFailure(async (client) => {
      await client.query("INSERT INTO public.claims (id) VALUES ($1)", [id(20)]);
      await client.query(
        `INSERT INTO public.claim_versions
          (id,claim_id,version_number,title,normalized_statement,language,claim_type,status,publication_status,change_reason,created_at)
         VALUES ($1,$2,1,'other','other','en','fact','active','published','fixture',$3)`,
        [id(21), id(20), TS],
      );
      await insertAnalysisBundle(client, id(804), { claimVersionId: id(21) });
    });
  });
  await t.test("attack 9 relation Evidence mismatch", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(805), { relationEvidenceId: EVIDENCE_IDS[1] }));
  });
  await t.test("attack 10 binding Evidence mismatch", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(806), { bindingEvidenceId: EVIDENCE_IDS[1] }));
  });
  await t.test("attack 11 binding Artifact mismatch", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(807), { bindingArtifactVersionId: ARTIFACT_VERSION_IDS[1] }));
  });
  await t.test("attack 12 binding outside bound Snapshot membership", async () => {
    await expectTransactionFailure(async (client) => {
      await client.query(
        `INSERT INTO public.evidence_artifact_bindings
          (id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version)
         VALUES ($1,$2,$3,$4,'rcv017-phase3','1')`,
        [id(499), EVIDENCE_IDS[0], ARTIFACT_VERSION_IDS[0], TS],
      );
      await insertAnalysisBundle(client, id(808), { bindingStatementId: id(499) });
    });
  });
  await t.test("attack 13 relation without binding fails at deferred boundary", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(809), { omitBinding: true }));
  });
});

test("RCV-017 typed finding and witness attacks fail closed", { skip: !enabled }, async (t) => {
  await t.test("attack 14 shared finding with one member", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(814), { bindingCount: 2 });
      await insertSharedFinding(client, id(814), { oneMember: true });
    });
  });
  await t.test("attack 15 shared member has wrong anchor", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(815), { bindingCount: 2 });
      await insertSharedFinding(client, id(815), { wrongAnchor: true });
    });
  });
  await t.test("attack 16 common finding with one member", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(816), { bindingCount: 2 });
      await insertCommonFinding(client, id(816), { oneMember: true });
    });
  });
  await t.test("attack 17 witness wrong start", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(817), { bindingCount: 2 });
      await insertCommonFinding(client, id(817), { wrongStart: true });
    });
  });
  await t.test("attack 18 witness wrong end", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(818), { bindingCount: 2 });
      await insertCommonFinding(client, id(818), { wrongEnd: true });
    });
  });
  await t.test("attack 19 witness statement foreign to Snapshot", async () => {
    await expectTransactionFailure(async (client) => {
      await client.query(
        `INSERT INTO public.artifact_provenance_statements
          (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,
           observed_at,payload_limits_id,payload_limits_version)
         VALUES ($1,$2,'quotes',$3,$4,'rcv017-phase3','1')`,
        [id(599), ARTIFACT_VERSION_IDS[0], ARTIFACT_VERSION_IDS[2], TS],
      );
      await insertAnalysisBundle(client, id(819), { bindingCount: 2 });
      await insertCommonFinding(client, id(819), { foreignStatement: true });
    });
  });
  await t.test("attack 20 duplicate witness ordinal", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(820), { bindingCount: 2 });
      await insertCommonFinding(client, id(820));
      await client.query(
        `INSERT INTO public.dependency_analysis_common_upstream_witness_steps
          (analysis_id,provenance_snapshot_id,direction,upstream_artifact_version_id,
           claim_version_evidence_relation_id,evidence_artifact_binding_statement_id,
           ordinal,artifact_version_id,artifact_provenance_statement_id)
         VALUES ($1,$2,'supports',$3,$4,$5,0,$6,$7)`,
        [id(820), SNAPSHOT_ID, ARTIFACT_VERSION_IDS[2], RELATION_IDS[0],
         BINDING_IDS[0], ARTIFACT_VERSION_IDS[0], PROVENANCE_IDS[0]],
      );
    });
  });
  await t.test("attack 21 negative pair uses same branch", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(821));
      await client.query(
        `INSERT INTO public.dependency_analysis_no_common_upstream_findings
          (analysis_id,direction,lower_claim_version_evidence_relation_id,
           lower_evidence_artifact_binding_statement_id,
           upper_claim_version_evidence_relation_id,
           upper_evidence_artifact_binding_statement_id)
         VALUES ($1,'supports',$2,$3,$2,$3)`,
        [id(821), RELATION_IDS[0], BINDING_IDS[0]],
      );
    });
  });
  await t.test("attack 22 negative pair is not canonically ordered", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(822), { bindingCount: 2 });
      await client.query(
        `INSERT INTO public.dependency_analysis_no_common_upstream_findings
          (analysis_id,direction,lower_claim_version_evidence_relation_id,
           lower_evidence_artifact_binding_statement_id,
           upper_claim_version_evidence_relation_id,
           upper_evidence_artifact_binding_statement_id)
         VALUES ($1,'supports',$2,$3,$4,$5)`,
        [id(822), RELATION_IDS[1], BINDING_IDS[1], RELATION_IDS[0], BINDING_IDS[0]],
      );
    });
  });
  await t.test("attack 23 knowledge finding without evidence", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(823));
      await client.query(
        `INSERT INTO public.dependency_analysis_knowledge_incomplete_findings
          (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
         VALUES ($1,$2,$3)`,
        [id(823), RELATION_IDS[0], BINDING_IDS[0]],
      );
    });
  });
  await t.test("attack 24 known-only KnowledgeState evidence", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(824), { bindingCount: 2 });
      await client.query(
        `INSERT INTO public.dependency_analysis_knowledge_incomplete_findings
          (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
         VALUES ($1,$2,$3)`,
        [id(824), RELATION_IDS[1], BINDING_IDS[1]],
      );
      await client.query(
        `INSERT INTO public.dependency_analysis_knowledge_state_evidence
          (analysis_id,provenance_snapshot_id,claim_version_evidence_relation_id,
           evidence_artifact_binding_statement_id,knowledge_state_statement_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [id(824), SNAPSHOT_ID, RELATION_IDS[1], BINDING_IDS[1], KNOWLEDGE_IDS[1]],
      );
    });
  });
});

test("RCV-017 layered integrity, append-only, atomicity, and live-state attacks", { skip: !enabled }, async (t) => {
  await t.test("attack 25 derived-unrecorded foreign semantic membership is intentionally DB-PARTIAL", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await insertAnalysisBundle(client, id(825));
      await client.query(
        `INSERT INTO public.dependency_analysis_knowledge_incomplete_findings
          (analysis_id,claim_version_evidence_relation_id,evidence_artifact_binding_statement_id)
         VALUES ($1,$2,$3)`,
        [id(825), RELATION_IDS[0], BINDING_IDS[0]],
      );
      await client.query(
        `INSERT INTO public.dependency_analysis_derived_unrecorded_evidence
          (analysis_id,claim_version_evidence_relation_id,
           evidence_artifact_binding_statement_id,artifact_version_id)
         VALUES ($1,$2,$3,$4)`,
        [id(825), RELATION_IDS[0], BINDING_IDS[0], ARTIFACT_VERSION_IDS[3]],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const row = await pool.query(
      "SELECT artifact_version_id::text FROM public.dependency_analysis_derived_unrecorded_evidence WHERE analysis_id=$1",
      [id(825)],
    );
    assert.equal(row.rows[0].artifact_version_id, ARTIFACT_VERSION_IDS[3]);
  });

  await t.test("attack 26 duplicate finding identity", async () => {
    await expectTransactionFailure(async (client) => {
      await insertAnalysisBundle(client, id(826), { bindingCount: 2 });
      await client.query(
        "INSERT INTO public.dependency_analysis_shared_artifact_findings (analysis_id,direction,artifact_version_id) VALUES ($1,'supports',$2)",
        [id(826), ARTIFACT_VERSION_IDS[0]],
      );
      await client.query(
        "INSERT INTO public.dependency_analysis_shared_artifact_findings (analysis_id,direction,artifact_version_id) VALUES ($1,'supports',$2)",
        [id(826), ARTIFACT_VERSION_IDS[0]],
      );
    });
  });

  await t.test("attacks 27-30 analysis and policy UPDATE/DELETE are rejected", async () => {
    await assert.rejects(
      pool.query("UPDATE public.claim_evidence_dependency_analyses SET analysis_schema_version='2' WHERE analysis_id=$1", [id(825)]),
      /append-only/i,
    );
    await assert.rejects(
      pool.query("DELETE FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1", [id(825)]),
      /append-only/i,
    );
    await assert.rejects(
      pool.query("UPDATE public.dependency_analysis_policies SET schema_version='2' WHERE policy_id=$1", [POLICY_ID]),
      /append-only/i,
    );
    await assert.rejects(
      pool.query("DELETE FROM public.dependency_analysis_policies WHERE policy_id=$1", [POLICY_ID]),
      /append-only/i,
    );
  });

  await t.test("attack 31 catalog proves no CASCADE action", async () => {
    const actions = await pool.query(`
      SELECT count(*)::integer AS count
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public'
        AND (t.relname LIKE 'dependency_analysis_%' OR t.relname='claim_evidence_dependency_analyses')
        AND c.contype='f' AND (c.confdeltype <> 'a' OR c.confupdtype <> 'a')
    `);
    assert.equal(actions.rows[0].count, 0);
  });

  await t.test("attack 32 deferred failure rolls back the complete analysis aggregate", async () => {
    const analysisId = id(832);
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, analysisId, { omitBinding: true }));
    const rows = await pool.query(`
      SELECT
        (SELECT count(*) FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1)::integer AS header,
        (SELECT count(*) FROM public.dependency_analysis_evidence_relations WHERE analysis_id=$1)::integer AS relations,
        (SELECT count(*) FROM public.dependency_analysis_bindings WHERE analysis_id=$1)::integer AS bindings
    `, [analysisId]);
    assert.deepEqual(rows.rows[0], { header: 0, relations: 0, bindings: 0 });
  });

  await t.test("attacks 33-35 later live provenance, binding, and KnowledgeState cannot enrich an analysis", async () => {
    const before = await pool.query(
      "SELECT analysis_canonical,analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1",
      [id(825)],
    );
    const laterEvidence = id(299);
    const laterProvenance = id(599);
    const laterBinding = id(499);
    const laterKnowledge = id(699);
    await pool.query("INSERT INTO public.evidence (id,retrieved_at,created_at) VALUES ($1,$2,$2)", [laterEvidence, TS]);
    await pool.query(
      `INSERT INTO public.artifact_provenance_statements
        (id,downstream_artifact_version_id,relationship_type,upstream_artifact_version_id,
         observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'quotes',$3,$4,'rcv017-phase3','1')`,
      [laterProvenance, ARTIFACT_VERSION_IDS[3], ARTIFACT_VERSION_IDS[2], TS],
    );
    await pool.query(
      `INSERT INTO public.evidence_artifact_bindings
        (id,evidence_id,artifact_version_id,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,$3,$4,'rcv017-phase3','1')`,
      [laterBinding, laterEvidence, ARTIFACT_VERSION_IDS[3], TS],
    );
    await pool.query(
      `INSERT INTO public.knowledge_state_statements
        (id,artifact_version_id,scope,state,observed_at,payload_limits_id,payload_limits_version)
       VALUES ($1,$2,'upstream_provenance','partial',$3,'rcv017-phase3','1')`,
      [laterKnowledge, ARTIFACT_VERSION_IDS[3], TS],
    );
    const after = await pool.query(
      `SELECT analysis_canonical,analysis_hash,
        (SELECT count(*)::integer FROM public.dependency_analysis_bindings WHERE analysis_id=$1) AS bindings,
        (SELECT count(*)::integer FROM public.dependency_analysis_common_upstream_witness_steps WHERE analysis_id=$1) AS witnesses
       FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1`,
      [id(825)],
    );
    assert.equal(after.rows[0].analysis_canonical, before.rows[0].analysis_canonical);
    assert.equal(after.rows[0].analysis_hash, before.rows[0].analysis_hash);
    assert.equal(after.rows[0].bindings, 1);
    assert.equal(after.rows[0].witnesses, 0);
  });

  await t.test("attack 36 policy v2 cannot substitute for v1", async () => {
    const client = await pool.connect();
    let v2Hash;
    try {
      await client.query("BEGIN");
      v2Hash = await insertPolicy(client, POLICY_ID, 2, '{"v":2}');
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await expectTransactionFailure((transaction) =>
      insertAnalysisBundle(transaction, id(836), { policyHash: v2Hash }));
  });

  await t.test("attack 37 another Snapshot cannot substitute for the exact bound Snapshot", async () => {
    await expectTransactionFailure((client) =>
      insertAnalysisBundle(client, id(837), { snapshotId: id(999) }));
  });

  await t.test("attacks 38-39 DB does not reconstruct JCS and matching-hash non-JCS persists byte-exactly", async () => {
    const analysisId = id(839);
    const nonJcs = '{ "z" : 1, "a" : 2 }';
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await insertAnalysisBundle(client, analysisId, { canonical: nonJcs });
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const stored = await pool.query(
      "SELECT analysis_canonical,analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1",
      [analysisId],
    );
    assert.deepEqual(stored.rows[0], { analysis_canonical: nonJcs, analysis_hash: hash(nonJcs) });
  });

  await t.test("attack 40 escaped U+0000 and literal backslash-u remain byte-distinct", async () => {
    const logicalNulCanonical = '{"value":"\\u0000"}';
    const literalEscapeCanonical = '{"value":"\\\\u0000"}';
    const ids = [id(840), id(841)];
    for (let index = 0; index < ids.length; index += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await insertAnalysisBundle(client, ids[index], {
          canonical: [logicalNulCanonical, literalEscapeCanonical][index],
        });
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    const stored = await pool.query(
      "SELECT analysis_canonical,analysis_hash FROM public.claim_evidence_dependency_analyses WHERE analysis_id=ANY($1::uuid[]) ORDER BY analysis_id::text COLLATE \"C\"",
      [ids],
    );
    assert.deepEqual(stored.rows, [
      { analysis_canonical: logicalNulCanonical, analysis_hash: hash(logicalNulCanonical) },
      { analysis_canonical: literalEscapeCanonical, analysis_hash: hash(literalEscapeCanonical) },
    ]);
  });

  await t.test("attack 41 analysisId collision fails without regeneration", async () => {
    await expectTransactionFailure((client) => insertAnalysisBundle(client, id(825)));
    const count = await pool.query(
      "SELECT count(*)::integer AS count FROM public.claim_evidence_dependency_analyses WHERE analysis_id=$1",
      [id(825)],
    );
    assert.equal(count.rows[0].count, 1);
  });
});

test.after(async () => {
  if (pool) await pool.end();
});
