const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require("../dist/services/rcv016RepositoryContract");

test("RCV-016 Snapshot repository contract fixes repeatable-read and technical errors", () => {
  assert.equal(contract.RCV016_SNAPSHOT_WRITE_ISOLATION, "repeatable_read");
  assert.equal(new contract.Rcv016RelationalIntegrityError("target", "missing").code, "relational_integrity_error");
  assert.equal(new contract.Rcv016SnapshotMembershipMismatchError("membership", "drift").code, "snapshot_membership_mismatch");
  assert.equal(new contract.Rcv016DatabaseError("transaction", "failed").code, "database_failure");
});

test("RCV-016 production repository exports no mutation, latest/current, ranking, or Payload lookup API", () => {
  const forbidden = /^(update|delete|getLatest|getCurrent|getWinner|getBest|getEffective|rank|score|inferIndependent|findIdentityByUrl|findIdentityByHash|getPayloadLimits|selectPayloadDefaults)/;
  assert.deepEqual(Object.keys(contract).filter((name) => forbidden.test(name)), []);
});
