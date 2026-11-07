const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { createPartnerIntegrationRouter } = require('../routes/partnerIntegration');

const secret = crypto.randomBytes(32).toString('base64url');
const secretHash = crypto.createHash('sha256').update(secret).digest();
const state = { shipActive: true, allowed: true, portExists: true, duplicate: null, created: null, history: 0, idem: new Map(), failHistory: false };
class Tx { async begin() {} async commit() {} async rollback() {} }
class Request {
  constructor(tx) { this.tx=tx; this.params={}; }
  input(k,_t,v) { this.params[k]=v; return this; }
  async query(q) {
    const p=this.params;
    if(q.includes('FROM dbo.partner_api_keys')) return {recordset: p.hash.equals(secretHash) ? [{key_hash:secretHash,partner_id:7,agent_id:9}] : []};
    if(q.includes('FROM dbo.partner_voyage_idempotency')) { const v=state.idem.get(`${p.partner}:${p.endpoint}:${p.key}`); return {recordset:v?[v]:[]}; }
    if(q.includes('FROM dbo.ships')) return {recordset:[{id:3,is_active:state.shipActive}]};
    if(q.includes('FROM dbo.partner_vessel_access')) return {recordset:state.allowed?[{allowed:1}]:[]};
    if(q.includes('FROM dbo.ports')) return {recordset:state.portExists?[{id:4}]:[]};
    if(q.includes('FROM dbo.voyages WITH')) return {recordset:state.duplicate?[{id:state.duplicate}]:[]};
    if(q.includes('INSERT dbo.voyages')) { state.created={id:41,agent:p.agent}; return {recordset:[{id:41}]}; }
    if(q.includes('INSERT dbo.voyage_status_history')) { if(state.failHistory) throw Error('failure'); state.history++; state.idem.set(`${p.partner}:${p.endpoint}:${p.key}`,{request_fingerprint:p.fingerprint,voyage_id:p.id}); return {recordset:[]}; }
    throw Error(`unexpected query ${q}`);
  }
}
const sql={Transaction:Tx,Request,Int:'int',VarBinary:'binary',VarChar:'varchar',NVarChar:'nvarchar',Char:'char',DateTime2:'datetime',ISOLATION_LEVEL:{SERIALIZABLE:1}};
let server, url;
function reset(){ Object.assign(state,{shipActive:true,allowed:true,portExists:true,duplicate:null,created:null,history:0,idem:new Map(),failHistory:false}); }
const body=overrides=>({vesselImo:'1234567',voyageNo:'DEMO-01',originPortCode:'DEMO',declaredEta:'2026-11-20T10:00:00Z',cargoType:'container',declaredTeu:10,...overrides});
async function send(payload=body(), headers={'X-API-Key':secret,'Idempotency-Key':'k1'}) { return fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)}); }
before(async()=>{const app=express();app.use(express.json());app.use('/api/v1/integration',createPartnerIntegrationRouter({sql,poolPromise:Promise.resolve({request:()=>new Request(null)}),logger:{info(){},error(){}}}));server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}/api/v1/integration/voyages`;});
after(async()=>new Promise(r=>server.close(r)));

test('requires key and validates JSON fields without database writes',async()=>{reset();assert.equal((await send(body(),{'Idempotency-Key':'k'})).status,401);assert.equal((await send(body({declaredEta:'tomorrow'}))).status,400);assert.equal((await send(body({declaredTeu:-1}))).status,400);assert.equal((await send(body({vesselImo:'bad'}))).status,400);});
test('rejects wrong, expired or revoked credentials as 401 without exposing token',async()=>{reset();const response=await send(body(),{'X-API-Key':'wrong','Idempotency-Key':'k'});assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/wrong/);});
test('enforces vessel scope and active vessel and port',async()=>{reset();state.allowed=false;assert.equal((await send()).status,403);reset();state.shipActive=false;assert.equal((await send()).status,422);reset();state.portExists=false;assert.equal((await send()).status,422);});
test('creates with key-owned agent, records history, replays, scopes idempotency and reports duplicates',async()=>{reset();const first=await send();const result=await first.json();assert.equal(first.status,201);assert.equal(result.referenceId,41);assert.equal(state.created.agent,9);assert.equal(state.history,1);assert.equal((await send()).status,200);assert.equal(state.history,1);assert.equal((await send(body({declaredTeu:11}))).status,409);reset();state.duplicate=77;const duplicate=await send(body(),{'X-API-Key':secret,'Idempotency-Key':'different'});const d=await duplicate.json();assert.equal(duplicate.status,409);assert.equal(d.referenceId,77);});
test('rolls back when history persistence fails',async()=>{reset();state.failHistory=true;assert.equal((await send()).status,500);assert.equal(state.history,0);});
