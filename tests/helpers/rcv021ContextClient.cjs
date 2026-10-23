const assert=require('node:assert/strict');
const key={research_operations:'operationId',research_operation_subject_bindings:'subjectBindingId',research_operation_trigger_bindings:'triggerBindingId',research_operation_lifecycle_events:'eventId',research_runs:'runId',research_run_lifecycle_events:'eventId',research_run_terminal_resolutions:'resolutionId',research_attempts:'attemptId',research_attempt_resolutions:'resolutionId',research_provider_results:'resultId',research_result_selections:'selectionId',rcv020_observation_occurrences:'occurrenceId'};
const property=name=>name.replace(/_([a-z])/g,(_m,c)=>c.toUpperCase());
class ContextClient {
  constructor(graph,options={}){this.sql=[];this.tx=false;this.options=options;this.scopes=new Map();this.tables={};for(const [table,field] of Object.entries({research_operations:'operation',research_operation_subject_bindings:'subject',research_operation_trigger_bindings:'trigger',research_operation_lifecycle_events:'operationLifecycleEvents',research_runs:'runs',research_run_lifecycle_events:'runLifecycleEvents',research_run_terminal_resolutions:'terminalResolutions',research_attempts:'attempts',research_attempt_resolutions:'attemptResolutions',research_provider_results:'providerResults',research_result_selections:'resultSelections',rcv020_observation_occurrences:'rcv020Occurrences'})){const value=graph[field];this.tables[table]=structuredClone(Array.isArray(value)?value:value?[value]:[]);}}
  release(destroy=false){this.released=(this.released??0)+1;this.destroyed=destroy;}
  async query(sql,values=[]){this.sql.push({text:sql,values});if(this.options.hook)await this.options.hook(sql,values,this);
    if(sql==='BEGIN'||sql==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'){if(this.tx)return {rows:[],rowCount:null,command:'BEGIN'};this.tx=true;this.outer=structuredClone(this.tables);return {rows:[],rowCount:null,command:'BEGIN'};}
    if(sql==='COMMIT'){this.tx=false;return {rows:[],rowCount:null,command:this.options.commitCommand??'COMMIT'};}
    if(sql==='ROLLBACK'){if(this.options.rollbackError)throw this.options.rollbackError;if(this.outer)this.tables=structuredClone(this.outer);this.tx=false;return {rows:[],rowCount:null,command:'ROLLBACK'};}
    if(sql.startsWith('SAVEPOINT ')){if(!this.tx)throw Object.assign(new Error('SAVEPOINT outside transaction'),{code:'25P01'});this.scopes.set(sql.split(' ')[1],structuredClone(this.tables));return {rows:[],rowCount:null,command:'SAVEPOINT'};}
    if(sql.startsWith('ROLLBACK TO SAVEPOINT ')){if(this.options.rollbackToError)throw this.options.rollbackToError;const before=this.scopes.get(sql.split(' ').at(-1));assert.ok(before,'owned scope exists');this.tables=structuredClone(before);return {rows:[],rowCount:null,command:'ROLLBACK'};}
    if(sql.startsWith('RELEASE SAVEPOINT ')){if(this.options.releaseScopeError)throw this.options.releaseScopeError;assert.equal(this.scopes.delete(sql.split(' ').at(-1)),true);return {rows:[],rowCount:null,command:'RELEASE'};}
    if(sql==="SELECT current_setting('transaction_isolation') AS isolation_level")return {rows:[{isolation_level:this.options.isolation??'read committed'}],rowCount:1,command:'SELECT'};
    const match=sql.match(/(?:FROM|INTO) public\.([a-z0-9_]+)/);assert.ok(match,'known contextual SQL');const table=match[1];assert.ok(this.tables[table],table);
    if(sql.startsWith('INSERT')){
      if(this.options.insertError&&sql.includes(this.options.insertError.table))throw this.options.insertError.error;
      const cols=sql.match(/\(([^)]+)\) VALUES/)[1].split(',');const record={};cols.forEach((col,index)=>record[property(col)]=col==='canonical_hash'?Buffer.from(values[index]).toString('hex'):values[index]);
      const idColumn=key[table],id=record[idColumn];const existing=this.tables[table].find(row=>row[idColumn]===id);
      if(existing)return {rows:[],rowCount:0,command:'INSERT'};
      this.tables[table].push(record);const returning=sql.match(/RETURNING ([a-z0-9_]+)/)[1];return {rows:[{[returning]:id}],rowCount:1,command:'INSERT'};
    }
    assert.ok(sql.startsWith('SELECT'),'measured SELECT');let rows=this.tables[table];
    const where=sql.match(/WHERE ([a-z0-9_]+)\s*=\s*(?:ANY\(\$1::uuid\[\]\)|\$1)/);
    if(where){const p=property(where[1]);rows=rows.filter(row=>Array.isArray(values[0])?values[0].includes(row[p]):row[p]===values[0]);}
    if(sql.includes("event_type = 'CLOSED'"))rows=rows.filter(row=>row.eventType==='CLOSED');
    rows=rows.map(row=>structuredClone(row));
    if(sql.startsWith('SELECT canonical, canonical_hash'))rows=rows.map(row=>({canonical:row.canonical,canonical_hash:Buffer.from(row.canonicalHash,'hex')}));
    else if(sql.startsWith('SELECT operation_id::text AS "operationId" FROM'))rows=rows.map(row=>({operationId:row.operationId}));
    else if(sql.startsWith('SELECT run_id::text AS "runId" FROM'))rows=rows.map(row=>({runId:row.runId}));
    else if(sql.startsWith('SELECT resolution_id FROM'))rows=rows.map(row=>({resolution_id:row.resolutionId}));
    else if(sql.startsWith('SELECT operation_id FROM'))rows=rows.map(row=>({operation_id:row.operationId}));
    else if(sql.startsWith('SELECT event_id FROM'))rows=rows.map(row=>({event_id:row.eventId}));
    if(this.options.missingMeasurement===table)return {rows:undefined,rowCount:rows.length,command:'SELECT'};
    if(this.options.wrongCount===table)return {rows,rowCount:String(rows.length),command:'SELECT'};
    return {rows,rowCount:rows.length,command:'SELECT'};
  }
}
const contextPool=client=>({connect:async()=>client});
module.exports={ContextClient,contextPool};
