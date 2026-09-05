import {
  RCV017_ALGORITHM_ID,
  RCV017_ALGORITHM_VERSION,
  RCV017_ANALYSIS_CANONICAL_FIELDS_V1,
  RCV017_ANALYSIS_SCHEMA_ID,
  RCV017_ANALYSIS_SCHEMA_VERSION,
  RCV017_CANONICALIZATION_ID,
  RCV017_CANONICALIZATION_VERSION,
  RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1,
  RCV017_HASH_ALGORITHM,
  RCV017_INPUT_DIRECTIONS_V1,
  RCV017_POLICY_CANONICAL_FIELDS_V1,
  RCV017_POLICY_RULES_V1,
  RCV017_POLICY_SCHEMA_ID,
  RCV017_POLICY_SCHEMA_VERSION,
  RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID,
  RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_VERSION,
  Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1,
  Rcv017DependencyAnalysisPolicyCanonicalV1,
  Rcv017FindingV1,
} from "../contracts/rcv017ClaimEvidenceDependencyContractV1";
import { canonicalizeRcv016, sha256Rcv016Text, validateRcv016CanonicalTimestamp } from "./rcv016Canonical";
import { verifyRcv016HistoricalSnapshot } from "./rcv016ReadVerifier";
import { freezeRcv016 } from "./rcv016Validation";
import { projectRcv017Persistence, Rcv017PersistenceProjectionV1 } from "./rcv017PersistenceProjection";
import { Rcv017PersistedAnalysisReadBundleV1 } from "./rcv017PostgresReadRepository";

export type Rcv017ReadIntegrityCode =
  | "canonical_hash_mismatch" | "canonical_not_jcs" | "unsupported_schema"
  | "policy_integrity_mismatch" | "snapshot_integrity_mismatch"
  | "relational_parity_mismatch" | "historical_input_mismatch"
  | "finding_reproduction_mismatch" | "witness_reproduction_mismatch"
  | "knowledge_reproduction_mismatch" | "limit_mismatch";

export class Rcv017ReadIntegrityError extends Error {
  constructor(public readonly code: Rcv017ReadIntegrityCode, public readonly path: string, message: string, public readonly cause?: unknown) {
    super(`${path}: ${message}`); this.name = "Rcv017ReadIntegrityError";
  }
}

export interface Rcv017VerifiedPersistedAnalysisV1 {
  readonly verified: true;
  readonly analysisId: string;
  readonly analysisHash: string;
  readonly analysisSchemaId: typeof RCV017_ANALYSIS_SCHEMA_ID;
  readonly analysisSchemaVersion: typeof RCV017_ANALYSIS_SCHEMA_VERSION;
}

type ObjectValue = Record<string, unknown>;
type Branch = { branchKey: { claimVersionEvidenceRelationId: string; evidenceArtifactBindingStatementId: string }; direction: "supports"|"contradicts"; anchor: string };
type Witness = { artifacts: string[]; statements: string[] };
type Closure = { witnesses: Map<string, Witness>; considered: Set<string> };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
const ascii=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const branchCompare=(a:Branch["branchKey"],b:Branch["branchKey"]):number=>ascii(a.claimVersionEvidenceRelationId,b.claimVersionEvidenceRelationId)||ascii(a.evidenceArtifactBindingStatementId,b.evidenceArtifactBindingStatementId);
const witnessCompare=(a:Witness,b:Witness):number=>a.statements.length-b.statements.length||a.statements.reduce((value,item,index)=>value||ascii(item,b.statements[index]),0);
const exact=(value:unknown,keys:readonly string[],path:string):ObjectValue=>{
  if(value===null||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Rcv017ReadIntegrityError("unsupported_schema",path,"expected a closed plain object");
  const actual=Reflect.ownKeys(value);if(actual.length!==keys.length||actual.some(k=>typeof k!=="string"||!keys.includes(k)))throw new Rcv017ReadIntegrityError("unsupported_schema",path,"unexpected or missing field");return value as ObjectValue;
};
const uuid=(v:unknown,p:string):string=>{if(typeof v!=="string"||!UUID.test(v))throw new Rcv017ReadIntegrityError("unsupported_schema",p,"invalid canonical UUID");return v;};
const hash=(v:unknown,p:string):string=>{if(typeof v!=="string"||!HASH.test(v))throw new Rcv017ReadIntegrityError("unsupported_schema",p,"invalid SHA-256 hex");return v;};
const positive=(v:unknown,p:string):number=>{if(typeof v!=="number"||!Number.isSafeInteger(v)||v<=0)throw new Rcv017ReadIntegrityError("unsupported_schema",p,"invalid positive safe integer");return v;};
const list=(v:unknown,p:string):unknown[]=>{if(!Array.isArray(v))throw new Rcv017ReadIntegrityError("unsupported_schema",p,"expected array");return v;};
const unique=(values:string[],path:string):void=>{if(new Set(values).size!==values.length)throw new Rcv017ReadIntegrityError("relational_parity_mismatch",path,"duplicate identity");};
const same=(a:unknown,b:unknown):boolean=>canonicalizeRcv016(a).canonical===canonicalizeRcv016(b).canonical;
const sortedRows=(values:readonly Readonly<Record<string,unknown>>[]):string[]=>values.map(v=>canonicalizeRcv016(v).canonical).sort(ascii);

function parseJcs(source: unknown, storedHash: unknown): ObjectValue {
  if(typeof source!=="string"||typeof storedHash!=="string"||!HASH.test(storedHash)||sha256Rcv016Text(source)!==storedHash)throw new Rcv017ReadIntegrityError("canonical_hash_mismatch","analysisCanonical","exact UTF-8 SHA-256 mismatch");
  let parsed:unknown;try{parsed=JSON.parse(source);}catch(error){throw new Rcv017ReadIntegrityError("canonical_not_jcs","analysisCanonical","invalid JSON",error);}
  try{if(canonicalizeRcv016(parsed).canonical!==source)throw new Error("not canonical");}catch(error){throw new Rcv017ReadIntegrityError("canonical_not_jcs","analysisCanonical","not exact RFC-8785/JCS",error);}
  return exact(parsed,RCV017_ANALYSIS_CANONICAL_FIELDS_V1,"analysisCanonical");
}

function policyFromRead(bundle:Rcv017PersistedAnalysisReadBundleV1):{definition:Rcv017DependencyAnalysisPolicyCanonicalV1;canonical:string;hash:string}{
  if(bundle.policyHeader===null)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policy","exact Policy missing");
  const h=bundle.policyHeader;const canonical=h.definitionCanonical,storedHash=h.definitionHash;
  if(typeof canonical!=="string"||typeof storedHash!=="string"||!HASH.test(storedHash)||sha256Rcv016Text(canonical)!==storedHash)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policy","Policy byte/hash mismatch");
  let value:unknown;try{value=JSON.parse(canonical);}catch(error){throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policy","invalid Policy JSON",error);}
  if(canonicalizeRcv016(value).canonical!==canonical)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policy","Policy is not JCS");
  const p=exact(value,RCV017_POLICY_CANONICAL_FIELDS_V1,"policyCanonical");
  if(p.schemaId!==RCV017_POLICY_SCHEMA_ID||p.schemaVersion!==RCV017_POLICY_SCHEMA_VERSION||p.relationshipClassificationCatalogId!==RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_ID||p.relationshipClassificationCatalogVersion!==RCV017_RELATIONSHIP_CLASSIFICATION_CATALOG_VERSION||p.canonicalizationId!==RCV017_CANONICALIZATION_ID||p.canonicalizationVersion!==RCV017_CANONICALIZATION_VERSION||p.hashAlgorithm!==RCV017_HASH_ALGORITHM)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policyCanonical","unsupported Policy identity");
  uuid(p.policyId,"policy.policyId");positive(p.policyVersion,"policy.policyVersion");for(const [key,expected] of Object.entries(RCV017_POLICY_RULES_V1))if(p[key]!==expected)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch",`policy.${key}`,"rule mismatch");
  for(const key of ["maxEvidenceRelations","maxBindings","maxArtifactVersions","maxStatements","maxDependencyDepth","maxFindings","maxCanonicalBytes"])positive(p[key],`policy.${key}`);
  const enabled=list(p.enabledDependencyRelationships,"policy.enabledDependencyRelationships") as string[];let previous=-1;if(enabled.length===0||enabled.some(v=>{const rank=(RCV017_DEPENDENCY_BEARING_RELATIONSHIPS_V1 as readonly string[]).indexOf(v);const invalid=typeof v!=="string"||rank<0||rank<=previous;previous=rank;return invalid;}))throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policy.enabledDependencyRelationships","invalid enabled relationship set");unique(enabled,"policy.enabledDependencyRelationships");
  const relational=bundle.policyRelationships.map(r=>String(r.relationship)).sort(ascii);if(!same(relational,[...enabled].sort(ascii)))throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policyRelationships","relational Policy set mismatch");
  const projected={...p};delete projected.enabledDependencyRelationships;for(const [key,value] of Object.entries(projected))if(h[key]!==value)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch",`policyHeader.${key}`,"Policy header parity mismatch");
  if(h.definitionCanonical!==canonical||h.definitionHash!==storedHash)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","policyHeader","Policy envelope mismatch");
  return {definition:p as unknown as Rcv017DependencyAnalysisPolicyCanonicalV1,canonical,hash:storedHash};
}

function validateInputs(a:ObjectValue):{relations:ObjectValue[];bindings:ObjectValue[]}{
  if(a.schemaId!==RCV017_ANALYSIS_SCHEMA_ID||a.schemaVersion!==RCV017_ANALYSIS_SCHEMA_VERSION||a.canonicalizationId!==RCV017_CANONICALIZATION_ID||a.canonicalizationVersion!==RCV017_CANONICALIZATION_VERSION||a.hashAlgorithm!==RCV017_HASH_ALGORITHM||a.algorithmId!==RCV017_ALGORITHM_ID||a.algorithmVersion!==RCV017_ALGORITHM_VERSION)throw new Rcv017ReadIntegrityError("unsupported_schema","analysisCanonical","unsupported analysis identity");
  uuid(a.claimVersionId,"claimVersionId");uuid(a.provenanceSnapshotId,"provenanceSnapshotId");hash(a.provenanceSnapshotHash,"provenanceSnapshotHash");uuid(a.dependencyAnalysisPolicyId,"dependencyAnalysisPolicyId");positive(a.dependencyAnalysisPolicyVersion,"dependencyAnalysisPolicyVersion");hash(a.dependencyAnalysisPolicyHash,"dependencyAnalysisPolicyHash");hash(a.algorithmArtifactHash,"algorithmArtifactHash");
  const relations=list(a.evidenceRelations,"evidenceRelations").map((v,i)=>{const r=exact(v,["claimVersionEvidenceRelationId","evidenceId","direction"],`evidenceRelations[${i}]`);uuid(r.claimVersionEvidenceRelationId,"relation.id");uuid(r.evidenceId,"relation.evidenceId");if(!RCV017_INPUT_DIRECTIONS_V1.includes(r.direction as never))throw new Rcv017ReadIntegrityError("unsupported_schema","relation.direction","invalid direction");return r;});
  const bindings=list(a.selectedBindings,"selectedBindings").map((v,i)=>{const b=exact(v,["claimVersionEvidenceRelationId","evidenceArtifactBindingStatementId","evidenceId","artifactVersionId"],`selectedBindings[${i}]`);for(const k of ["claimVersionEvidenceRelationId","evidenceArtifactBindingStatementId","evidenceId","artifactVersionId"])uuid(b[k],`binding.${k}`);return b;});
  if(relations.length===0||bindings.length===0)throw new Rcv017ReadIntegrityError("unsupported_schema","analysisCanonical","inputs must be non-empty");
  unique(relations.map(r=>String(r.claimVersionEvidenceRelationId)),"evidenceRelations");unique(bindings.map(b=>String(b.evidenceArtifactBindingStatementId)),"selectedBindings");unique(bindings.map(b=>`${b.claimVersionEvidenceRelationId}\0${b.evidenceArtifactBindingStatementId}`),"branches");
  if(!same(relations,[...relations].sort((x,y)=>ascii(String(x.claimVersionEvidenceRelationId),String(y.claimVersionEvidenceRelationId)))))throw new Rcv017ReadIntegrityError("relational_parity_mismatch","evidenceRelations","noncanonical ordering");
  if(!same(bindings,[...bindings].sort((x,y)=>ascii(String(x.claimVersionEvidenceRelationId),String(y.claimVersionEvidenceRelationId))||ascii(String(x.evidenceArtifactBindingStatementId),String(y.evidenceArtifactBindingStatementId)))))throw new Rcv017ReadIntegrityError("relational_parity_mismatch","selectedBindings","noncanonical ordering");
  return {relations,bindings};
}

function closure(branch:Branch,outgoing:Map<string,ObjectValue[]>,enabled:Set<string>,maxDepth:number,artifacts:Set<string>):Closure{
  const root={artifacts:[branch.anchor],statements:[]};const witnesses=new Map<string,Witness>([[branch.anchor,root]]),considered=new Set<string>(),expanded=new Set<string>();const queue:Witness[]=[root];
  while(queue.length){queue.sort(witnessCompare);const path=queue.shift() as Witness,node=path.artifacts[path.artifacts.length-1];if(witnesses.get(node)!==path||expanded.has(node))continue;expanded.add(node);if(path.statements.length>=maxDepth)continue;for(const s of outgoing.get(node)??[]){if(!enabled.has(String(s.relationship)))continue;considered.add(String(s.statementId));const upstream=String(s.objectArtifactVersionId);if(!artifacts.has(upstream))throw new Rcv017ReadIntegrityError("snapshot_integrity_mismatch","snapshot","foreign upstream");if(path.artifacts.includes(upstream))continue;const candidate={artifacts:[...path.artifacts,upstream],statements:[...path.statements,String(s.statementId)]};const old=witnesses.get(upstream);if(!old||witnessCompare(candidate,old)<0){witnesses.set(upstream,candidate);queue.push(candidate);}}}
  return {witnesses,considered};
}

function reproduce(a:ObjectValue,p:Rcv017DependencyAnalysisPolicyCanonicalV1,s:ObjectValue):Rcv017FindingV1[]{
  const {relations,bindings}=validateInputs(a),relationById=new Map(relations.map(r=>[String(r.claimVersionEvidenceRelationId),r]));const snapshotBindings=new Map((s.evidenceArtifactBindings as ObjectValue[]).map(b=>[String(b.statementId),b])),artifactSet=new Set((s.artifactVersions as ObjectValue[]).map(v=>String(v.artifactVersionId)));
  const branches:Branch[]=[],covered=new Set<string>();for(const b of bindings){const r=relationById.get(String(b.claimVersionEvidenceRelationId));if(!r||r.evidenceId!==b.evidenceId)throw new Rcv017ReadIntegrityError("historical_input_mismatch","selectedBindings","relation Evidence mismatch");covered.add(String(b.claimVersionEvidenceRelationId));const historical=snapshotBindings.get(String(b.evidenceArtifactBindingStatementId));if(!historical||historical.subjectEvidenceId!==b.evidenceId||historical.objectArtifactVersionId!==b.artifactVersionId||!artifactSet.has(String(b.artifactVersionId)))throw new Rcv017ReadIntegrityError("historical_input_mismatch","selectedBindings","Snapshot binding mismatch");if(r.direction!=="contextualizes")branches.push({branchKey:{claimVersionEvidenceRelationId:String(b.claimVersionEvidenceRelationId),evidenceArtifactBindingStatementId:String(b.evidenceArtifactBindingStatementId)},direction:r.direction as Branch["direction"],anchor:String(b.artifactVersionId)});}if(relations.some(r=>!covered.has(String(r.claimVersionEvidenceRelationId))))throw new Rcv017ReadIntegrityError("historical_input_mismatch","evidenceRelations","relation without binding");
  const outgoing=new Map<string,ObjectValue[]>();for(const statement of s.artifactProvenanceStatements as ObjectValue[]){const key=String(statement.subjectArtifactVersionId),values=outgoing.get(key)??[];values.push(statement);outgoing.set(key,values);}for(const values of outgoing.values())values.sort((x,y)=>ascii(String(x.statementId),String(y.statementId)));
  const closures=new Map<Branch,Closure>(),reached=new Set<string>(),considered=new Set<string>(),enabled=new Set(p.enabledDependencyRelationships as readonly string[]);for(const b of branches){const c=closure(b,outgoing,enabled,p.maxDependencyDepth,artifactSet);closures.set(b,c);for(const id of c.witnesses.keys())reached.add(id);for(const id of c.considered)considered.add(id);}
  if(relations.length>p.maxEvidenceRelations||bindings.length>p.maxBindings||reached.size>p.maxArtifactVersions||considered.size>p.maxStatements)throw new Rcv017ReadIntegrityError("limit_mismatch","analysis","input or traversal limit exceeded");
  const findings:any[]=[];for(const direction of ["supports","contradicts"] as const){const partition=branches.filter(b=>b.direction===direction),anchors=new Map<string,Branch[]>();for(const b of partition){const values=anchors.get(b.anchor)??[];values.push(b);anchors.set(b.anchor,values);}for(const [artifact,members] of anchors)if(members.length>=2)findings.push({type:"RECORDED_SHARED_ARTIFACT_VERSION",direction,artifactVersionId:artifact,members:members.map(m=>m.branchKey).sort(branchCompare)});
    for(const upstream of [...reached].sort(ascii)){const members=partition.filter(b=>closures.get(b)?.witnesses.has(upstream));if(members.length<2)continue;const values=members.map(b=>{const w=closures.get(b)?.witnesses.get(upstream) as Witness;return{branchKey:b.branchKey,witness:{artifactVersionIds:w.artifacts,artifactProvenanceStatementIds:w.statements}};}).sort((x,y)=>branchCompare(x.branchKey,y.branchKey));if(values.some(m=>m.witness.artifactProvenanceStatementIds.length>0))findings.push({type:"RECORDED_COMMON_UPSTREAM",direction,upstreamArtifactVersionId:upstream,members:values});}
    for(let i=0;i<partition.length;i++)for(let j=i+1;j<partition.length;j++){const x=partition[i],y=partition[j];if(x.anchor===y.anchor)continue;const xc=closures.get(x) as Closure,yc=closures.get(y) as Closure;if([...xc.witnesses.keys()].some(k=>yc.witnesses.has(k)))continue;const pair=branchCompare(x.branchKey,y.branchKey)<0?[x.branchKey,y.branchKey]:[y.branchKey,x.branchKey];findings.push({type:"NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE",direction,lowerBranchKey:pair[0],upperBranchKey:pair[1]});}}
  const knowledge=new Map<string,ObjectValue[]>();for(const k of s.knowledgeStateStatements as ObjectValue[])if(k.scope==="upstream_provenance"&&(k.state==="unknown"||k.state==="partial")){const values=knowledge.get(String(k.subjectArtifactVersionId))??[];values.push(k);knowledge.set(String(k.subjectArtifactVersionId),values);}const derived=new Set((s.derivedUnrecordedStates as ObjectValue[]).map(v=>String(v.artifactVersionId)));
  for(const b of branches){const ids:string[]=[],unrecorded:string[]=[],affected=new Set<string>();for(const artifact of (closures.get(b) as Closure).witnesses.keys()){const values=knowledge.get(artifact)??[];if(values.length){affected.add(artifact);ids.push(...values.map(v=>String(v.statementId)));}if(derived.has(artifact)){affected.add(artifact);unrecorded.push(artifact);}}if(ids.length||unrecorded.length)findings.push({type:"DEPENDENCY_KNOWLEDGE_INCOMPLETE",branchKey:b.branchKey,affectedArtifactVersionIds:[...affected].sort(ascii),knowledgeStateStatementIds:ids.sort(ascii),derivedUnrecordedArtifactVersionIds:unrecorded.sort(ascii)});}
  const rank:any={RECORDED_SHARED_ARTIFACT_VERSION:0,RECORDED_COMMON_UPSTREAM:1,NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE:2,DEPENDENCY_KNOWLEDGE_INCOMPLETE:3},dr:any={supports:0,contradicts:1};findings.sort((x,y)=>rank[x.type]-rank[y.type]||(x.direction!==undefined?dr[x.direction]-dr[y.direction]:0)||ascii(String(x.artifactVersionId??x.upstreamArtifactVersionId??x.branchKey?.claimVersionEvidenceRelationId??x.lowerBranchKey?.claimVersionEvidenceRelationId),String(y.artifactVersionId??y.upstreamArtifactVersionId??y.branchKey?.claimVersionEvidenceRelationId??y.lowerBranchKey?.claimVersionEvidenceRelationId))||(x.type==="NO_RECORDED_COMMON_UPSTREAM_WITHIN_SCOPE"?branchCompare(x.lowerBranchKey,y.lowerBranchKey)||branchCompare(x.upperBranchKey,y.upperBranchKey):x.type==="DEPENDENCY_KNOWLEDGE_INCOMPLETE"?branchCompare(x.branchKey,y.branchKey):0));
  if(findings.length>p.maxFindings)throw new Rcv017ReadIntegrityError("limit_mismatch","findings","maxFindings exceeded");return findings as Rcv017FindingV1[];
}

function assertProjection(bundle:Rcv017PersistedAnalysisReadBundleV1,expected:Rcv017PersistenceProjectionV1):void{
  const names=["policyRelationships","evidenceRelations","bindings","sharedArtifactFindings","sharedArtifactMembers","commonUpstreamFindings","commonUpstreamMembers","commonUpstreamWitnessSteps","noCommonUpstreamFindings","knowledgeIncompleteFindings","knowledgeAffectedArtifacts","knowledgeStateEvidence","derivedUnrecordedEvidence"] as const;
  for(const name of names)if(!same(sortedRows(bundle[name]),sortedRows(expected[name])))throw new Rcv017ReadIntegrityError(name.includes("Witness")?"witness_reproduction_mismatch":name.includes("Knowledge")||name.includes("derived")?"knowledge_reproduction_mismatch":"relational_parity_mismatch",name,"Canonical/relational projection mismatch");
  for(const [key,value] of Object.entries(expected.analysisHeader))if(bundle.header[key]!==value)throw new Rcv017ReadIntegrityError("relational_parity_mismatch",`header.${key}`,"analysis header parity mismatch");
}

/** CONTRACT-MAPPED independent verification; it performs no writes or repair. */
export async function verifyRcv017PersistedAnalysis(bundle:Rcv017PersistedAnalysisReadBundleV1,supportedAlgorithmArtifactHash:unknown):Promise<Rcv017VerifiedPersistedAnalysisV1>{
  const expectedAlgorithmHash=hash(supportedAlgorithmArtifactHash,"supportedAlgorithmArtifactHash");
  const analysisId=uuid(bundle.header.analysisId,"header.analysisId");validateRcv016CanonicalTimestamp(bundle.header.createdAt,"header.createdAt");
  const parsed=parseJcs(bundle.header.analysisCanonical,bundle.header.analysisHash),inputs=validateInputs(parsed),policy=policyFromRead(bundle);
  if(parsed.algorithmArtifactHash!==expectedAlgorithmHash)throw new Rcv017ReadIntegrityError("unsupported_schema","algorithmArtifactHash","unsupported algorithm artifact identity");
  if(parsed.dependencyAnalysisPolicyId!==policy.definition.policyId||parsed.dependencyAnalysisPolicyVersion!==policy.definition.policyVersion||parsed.dependencyAnalysisPolicyHash!==policy.hash)throw new Rcv017ReadIntegrityError("policy_integrity_mismatch","analysisCanonical","Policy binding mismatch");
  if(bundle.rcv016SnapshotRead===null)throw new Rcv017ReadIntegrityError("snapshot_integrity_mismatch","provenanceSnapshot","exact Snapshot missing");
  let verifiedSnapshot;try{verifiedSnapshot=await verifyRcv016HistoricalSnapshot(parsed.provenanceSnapshotId,{loadHistoricalSnapshotById:async()=>bundle.rcv016SnapshotRead});}catch(error){throw new Rcv017ReadIntegrityError("snapshot_integrity_mismatch","provenanceSnapshot","RCV-016 verification failed",error);}
  if(verifiedSnapshot.snapshotHash!==parsed.provenanceSnapshotHash||bundle.header.provenanceSnapshotId!==parsed.provenanceSnapshotId||bundle.header.provenanceSnapshotHash!==parsed.provenanceSnapshotHash)throw new Rcv017ReadIntegrityError("snapshot_integrity_mismatch","provenanceSnapshot","Snapshot ID/hash parity mismatch");
  if(bundle.historicalClaimVersion===null||bundle.historicalClaimVersion.id!==parsed.claimVersionId)throw new Rcv017ReadIntegrityError("historical_input_mismatch","claimVersionId","historical ClaimVersion missing");
  if(new Set(bundle.historicalEvidenceIds).size!==bundle.historicalEvidenceIds.length||!same([...bundle.historicalEvidenceIds].sort(ascii),[...new Set(inputs.relations.map(r=>String(r.evidenceId)))].sort(ascii)))throw new Rcv017ReadIntegrityError("historical_input_mismatch","evidence","historical Evidence mismatch");
  const expectedHistorical=inputs.relations.map(r=>({claimVersionEvidenceRelationId:r.claimVersionEvidenceRelationId,claimVersionId:parsed.claimVersionId,evidenceId:r.evidenceId,direction:r.direction}));if(!same(sortedRows(bundle.historicalEvidenceRelations),sortedRows(expectedHistorical)))throw new Rcv017ReadIntegrityError("historical_input_mismatch","evidenceRelations","historical relation mismatch");
  let snapshot:ObjectValue;try{snapshot=JSON.parse(bundle.rcv016SnapshotRead.header.snapshotCanonical);}catch(error){throw new Rcv017ReadIntegrityError("snapshot_integrity_mismatch","provenanceSnapshot","Snapshot parse failed",error);}
  const expectedFindings=reproduce(parsed,policy.definition,snapshot);if(!same(parsed.findings,expectedFindings))throw new Rcv017ReadIntegrityError("finding_reproduction_mismatch","findings","stored findings do not independently reproduce");
  const expectedAnalysis={...parsed,findings:expectedFindings} as unknown as Rcv017ClaimEvidenceDependencyAnalysisCanonicalV1;if(Buffer.byteLength(String(bundle.header.analysisCanonical),"utf8")>policy.definition.maxCanonicalBytes)throw new Rcv017ReadIntegrityError("limit_mismatch","analysisCanonical","maxCanonicalBytes exceeded");
  const expectedProjection=projectRcv017Persistence(expectedAnalysis,String(bundle.header.analysisCanonical),String(bundle.header.analysisHash) as never,policy.definition,policy.canonical,policy.hash as never);assertProjection(bundle,expectedProjection);
  return freezeRcv016({verified:true,analysisId,analysisHash:String(bundle.header.analysisHash),analysisSchemaId:RCV017_ANALYSIS_SCHEMA_ID,analysisSchemaVersion:RCV017_ANALYSIS_SCHEMA_VERSION}) as Rcv017VerifiedPersistedAnalysisV1;
}
