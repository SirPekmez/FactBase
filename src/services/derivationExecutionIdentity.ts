import {
  DERIVATION_EXECUTION_CONTRACT_ID,
  DERIVATION_EXECUTION_CONTRACT_VERSION,
  DERIVATION_RUNTIME_ID,
} from "../types/derivation";
import {
  getDerivationSafeRuntimeArtifactHash as exportedGetDerivationSafeRuntimeArtifactHash,
  loadedFunctionSource as exportedLoadedFunctionSource,
  safeSha256 as exportedSafeSha256,
} from "./derivationSafeRuntime";

function initializeExecutionIdentityBindings() {
  return Object.freeze({
    getDerivationSafeRuntimeArtifactHash:
      exportedGetDerivationSafeRuntimeArtifactHash,
    loadedFunctionSource: exportedLoadedFunctionSource,
    safeSha256: exportedSafeSha256,
  });
}

const EXECUTION_IDENTITY_BINDINGS = initializeExecutionIdentityBindings();

const LOADED_NODE_VERSION = process.versions.node;
const LOADED_V8_VERSION = process.versions.v8;
const LOADED_RUNTIME_VERSION = `node:${LOADED_NODE_VERSION};v8:${LOADED_V8_VERSION}`;

const LOADED_EXECUTION_CONTRACT_HASH = EXECUTION_IDENTITY_BINDINGS.safeSha256(
  [
    "factbase-derivation-interpreter-execution-contract-v1",
    DERIVATION_EXECUTION_CONTRACT_ID,
    DERIVATION_EXECUTION_CONTRACT_VERSION,
    DERIVATION_RUNTIME_ID,
    LOADED_RUNTIME_VERSION,
    EXECUTION_IDENTITY_BINDINGS.getDerivationSafeRuntimeArtifactHash(),
    EXECUTION_IDENTITY_BINDINGS.loadedFunctionSource(
      initializeExecutionIdentityBindings,
    ),
    EXECUTION_IDENTITY_BINDINGS.loadedFunctionSource(
      EXECUTION_IDENTITY_BINDINGS.safeSha256,
    ),
    "strict-equality",
    "property-read",
    "numeric-for-loop",
    "safe-own-array-element-definition",
    "array-length-read",
    "object-array-literals",
  ].join("\n"),
);

export interface DerivationExecutionIdentity {
  contractId: typeof DERIVATION_EXECUTION_CONTRACT_ID;
  contractVersion: typeof DERIVATION_EXECUTION_CONTRACT_VERSION;
  contractHash: string;
  runtimeId: typeof DERIVATION_RUNTIME_ID;
  runtimeVersion: string;
}

export function getDerivationExecutionIdentity(): DerivationExecutionIdentity {
  return {
    contractId: DERIVATION_EXECUTION_CONTRACT_ID,
    contractVersion: DERIVATION_EXECUTION_CONTRACT_VERSION,
    contractHash: LOADED_EXECUTION_CONTRACT_HASH,
    runtimeId: DERIVATION_RUNTIME_ID,
    runtimeVersion: LOADED_RUNTIME_VERSION,
  };
}
