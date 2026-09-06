const assert = require("node:assert/strict");
const test = require("node:test");
const canon = require("../dist/services/rcv018Canonical");
const { buildRcv018Analysis } = require("../dist/services/rcv018AnalysisBuilder");
const { verifyRcv018Write } = require("../dist/services/rcv018WriteVerifier");
const { persistRcv018Analysis, Rcv018PersistenceError } = require("../dist/services/rcv018PostgresRepository");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hash = (c) => String(c).repeat(64).slice(0, 64);
const auth = (value) => { const e = canon.canonicalizeRcv018(value); return { value, canonical: e.canonical, hash: e.hash }; };
const domain = auth({ valueDomainId: id(1), valueDomainVersion: 1, kind: "CLOSED_SYMBOLIC_STATE", allowedValues: ["A", "B"] });
const comparison = auth({ comparisonDomainId: id(2), comparisonDomainVersion: 1, propertyId: id(3), valueDomainId: id(1), valueDomainVersion: 1, valueDomainHash: domain.hash, comparisonKeySchema: [], ruleFamily: "EXPLICIT_MUTUALLY_EXCLUSIVE_PAIR", incompatibilityPairs: [["A", "B"]] });
const binding = { contractId: "contract", contractVersion: 1, contractHash: hash("c") };
const algorithm = { algorithmId: "algorithm", algorithmVersion: 1, algorithmHash: hash("d") };
const assertion = (n, value) => auth({ assertionId: id(n), subjectId: id(10), propertyId: id(3), comparisonDomainId: id(2), comparisonDomainVersion: 1, comparisonDomainHash: comparison.hash, valueDomainId: id(1), valueDomainVersion: 1, valueDomainHash: domain.hash, value, comparisonContext: [], evidenceBasis: [{ evidenceRelationId: id(100+n), evidenceId: id(200+n), artifactVersionId: id(300+n), statementKind: "ArtifactProvenanceStatement", statementId: id(999) }], historicalBindings: [{ kind: "STATEMENT", statementKind: "ArtifactProvenanceStatement", statementId: id(999) }] });
function projection() { const builderInput = { analysisId: id(500), assertions: [assertion(1, "A"), assertion(2, "B")], valueDomains: [domain], comparisonDomains: [comparison], contractBinding: binding, algorithmBinding: algorithm }; return verifyRcv018Write({ builderInput, builderResult: buildRcv018Analysis(builderInput), existingFindings: [] }); }
function fakePool(failAt) { const trace = []; const client = { async query(text) { trace.push(text); if (failAt && text.includes(failAt)) throw Object.assign(new Error("forced"), { code: "XX000" }); return { rowCount: text.startsWith("SELECT") ? 1 : 1, rows: [] }; }, release() { trace.push("RELEASE"); } }; return { trace, async connect() { trace.push("CONNECT"); return client; } }; }

test("repository writes authenticated projection atomically with parameterized inserts", async () => {
  const pool = fakePool(); const result = await persistRcv018Analysis(pool, projection());
  assert.equal(result.analysisId, id(500)); assert.equal(pool.trace[1], "BEGIN ISOLATION LEVEL READ COMMITTED"); assert.equal(pool.trace.at(-2), "COMMIT");
  assert.ok(pool.trace.some((q) => q.includes("INSERT INTO public.rcv018_analyses")));
  assert.ok(pool.trace.every((q) => !/ON CONFLICT|UPDATE|DELETE/i.test(q)));
});

test("repository rolls back after a middle-write failure and never reports success", async () => {
  const pool = fakePool("rcv018_analysis_assertions");
  await assert.rejects(() => persistRcv018Analysis(pool, projection()), (e) => e instanceof Rcv018PersistenceError && e.code === "database_error");
  assert.ok(pool.trace.includes("ROLLBACK")); assert.ok(!pool.trace.includes("COMMIT"));
});
