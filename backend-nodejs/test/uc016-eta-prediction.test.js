const { test, beforeEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createVoyageEtaService } = require('../services/voyageEtaPrediction');
const { createVoyageEtaRouter } = require('../routes/voyageEtaPrediction');
const { parsePolicy } = require('../services/voyageValidationPolicy');
const now = new Date('2026-11-07T00:00:00Z');
const clock = () => new Date(now);
const key = require('node:crypto').randomBytes(32).toString('hex');
const env = { UC015_DEMO_ENABLED:'true',UC015_OPERATOR_TOKEN:key,DB_SERVER:'test-host',DB_DATABASE:'CangThongMinh_UC015_Test',
    UC015_TEST_SERVER_NAME:'TEST-HOST',UC015_TEST_DATABASE_GUID:'12345678-1234-1234-1234-123456789abc' };
const policy = parsePolicy({ mode:'DEMO',policyId:'unit-policy',reviewedAt:'2026-11-01T00:00:00Z',validUntil:'2026-12-01T00:00:00Z',
    requiredDocumentTypesByShipType:{ Container:['Registry'] },restrictedImos:[] });
const voyage = (id=1,extra={}) => ({ id,ship_id:7,ship_exists:7,is_active:true,imo_number:'9074729',ship_type:'Container',
    ship_code:'S7',ship_name:'Test vessel',capacity:200,length_overall:100,draft:9,voyage_code:`V${id}`,origin_port_id:1,
    origin_port_code:'TEST',agent_id:1,cargo_type:'container',declared_teu:10,priority_level:0,
    declared_eta:new Date('2026-11-10T12:00:00Z'),status:'QUEUED',validation_result:'VALID',validated_at:now,
    queue_position:id,queued_at:now,predicted_eta:null,ai_status:'UNAVAILABLE',latest_eta_prediction_id:null,...extra });
const available = eta => ({ aiStatus:'AVAILABLE',predictionSource:'MODEL',predictedEta:eta || '2026-11-10T14:00:00Z',
    etaConfidence:0.8,modelVersion:'unit-model-v1' });
const output = h => ({ predictionId:String(h.id),voyageId:h.voyage_id,declaredEta:h.declared_eta,predictedEta:h.predicted_eta,
    etaDeviationH:h.predicted_eta ? Number(((h.predicted_eta-h.declared_eta)/3600000).toFixed(6)) : null,
    etaConfidence:h.eta_confidence,aiStatus:h.ai_status,modelVersion:h.model_version,failureReason:h.failure_reason,
    applicationStatus:h.application_status,discardReason:h.discard_reason,
    effectiveEta:h.application_status==='APPLIED' ? h.predicted_eta || h.declared_eta : h.declared_eta,requestedAt:h.requested_at,predictedAt:h.predicted_at });
function database() {
    const db={ state:{ voyages:[voyage()],predictions:[],historical:[],docs:[{ ship_id:7,id:1,document_type:'Registry',review_status:'APPROVED',
        valid_from:new Date('2026-11-01T00:00:00Z'),valid_until:new Date('2026-11-30T00:00:00Z') }] },
        queries:[],fail:null,active:0,tail:Promise.resolve(),next:1 };
    class Transaction {
        async begin() { db.active++; }
        async commit() { if(this.staged) db.state=this.staged; db.active--; this.release?.(); }
        async rollback() { db.active--; this.release?.(); }
    }
    class Request {
        constructor(c) { this.tx=c instanceof Transaction ? c : null; this.p={}; }
        input(n,t,v) { assert.notEqual(t,undefined); this.p[n]=v; return this; }
        async query(q) {
            db.queries.push(q); const tag=/uc01[56]:(\w+)/.exec(q)?.[1]; const p=this.p;
            if (tag===db.fail) throw new Error(`Injected ${tag} failure`);
            if (tag==='database') return { recordset:[{ databaseName:db.badDatabase || env.DB_DATABASE,serverName:env.UC015_TEST_SERVER_NAME,databaseGuid:env.UC015_TEST_DATABASE_GUID }] };
            if (tag==='lock') {
                const prior=db.tail; db.tail=new Promise(resolve=>{ this.tx.release=resolve; }); await prior;
                this.tx.staged=structuredClone(db.state); return { recordset:[{ lockResult:0 }] };
            }
            const state=this.tx?.staged || db.state; const row=state.voyages.find(v=>v.id===p.id);
            if (tag==='inputs') return { recordset:row ? [{ ...structuredClone(row),
                latest_eta_prediction_cursor:row.latest_eta_prediction_id == null ? null : String(row.latest_eta_prediction_id) }] : [] };
            if (tag==='features') return { recordset:structuredClone(state.historical) };
            if (tag==='documents') return { recordset:structuredClone(state.docs.filter(d=>d.ship_id===p.ship)) };
            if (tag==='history') {
                assert.ok(this.tx?.staged);
                const id=db.next++;
                state.predictions.push({ id,voyage_id:p.id,declared_eta:p.declared,predicted_eta:p.predicted,
                    eta_confidence:p.confidence,ai_status:p.ai,model_version:p.model,failure_reason:p.reason,
                    application_status:p.application,discard_reason:p.discard,input_hash:p.hash,input_json:p.json,requested_at:p.requested,predicted_at:p.completed });
                return { recordset:[{ predictionId:String(id) }] };
            }
            if (tag==='apply') {
                assert.ok(this.tx?.staged); assert.doesNotMatch(q,/SET\s+(status|validation_result|queued_at)/i);
                Object.assign(row,{ predicted_eta:p.predicted,ai_status:p.ai,eta_input_hash:p.hash,latest_eta_prediction_id:p.prediction_id });
                return { recordset:[] };
            }
            if (tag==='reorder') {
                const rows=state.voyages.filter(v=>v.status==='QUEUED' && v.validation_result==='VALID');
                rows.sort((a,b)=>new Date(a.predicted_eta || a.declared_eta)-new Date(b.predicted_eta || b.declared_eta) || b.priority_level-a.priority_level || a.id-b.id);
                rows.forEach((v,i)=>{v.queue_position=i+1;}); return { recordset:[] };
            }
            if (tag==='result') return { recordset:[output(state.predictions.find(h=>String(h.id)===String(p.prediction_id)))] };
            if (tag==='list') return { recordset:state.predictions.filter(h=>h.voyage_id===p.id && (p.before==null || BigInt(h.id)<BigInt(p.before))).slice().reverse().slice(0,51).map(output) };
            throw new Error(`Unexpected query ${q}`);
        }
    }
    db.sql={ Transaction,Request,Int:'Int',BigInt:'BigInt',VarChar:()=> 'VarChar',NVarChar:()=> 'NVarChar',Char:()=> 'Char',
        DateTime2:()=> 'DateTime2',Decimal:()=> 'Decimal',MAX:'MAX',ISOLATION_LEVEL:{ SERIALIZABLE:'SERIALIZABLE' } };
    db.poolPromise=Promise.resolve({});
    db.service=opts=>createVoyageEtaService({ sql:db.sql,poolPromise:db.poolPromise,env,policy,clock,
        adapter:{ async predict() { assert.equal(db.active,0); return available(); } },...opts });
    return db;
}
let db;
beforeEach(()=>{ db=database(); });
for (const [delta,eta] of [[2,'2026-11-10T14:00:00Z'],[-2.5,'2026-11-10T09:30:00Z']])
    test(`valid prediction stores signed deviation ${delta} hours and model history`,async()=>{
        const before=structuredClone(db.state.voyages[0]);
        const result=await db.service({ adapter:{ async predict(input) {
            assert.equal(db.active,0); assert.equal(input.speedKnots,null); assert.equal(input.weather,null);
            return available(eta);
        } } }).predict(1);
        assert.equal(result.httpStatus,200); assert.equal(result.body.etaDeviationH,delta);
        assert.equal(result.body.modelVersion,'unit-model-v1'); assert.equal(result.body.etaConfidence,0.8);
        assert.equal(db.state.predictions.length,1); assert.equal(result.body.applicationStatus,'APPLIED');
        for(const field of ['queued_at','validation_result','validated_at','status']) assert.deepEqual(db.state.voyages[0][field],before[field]);
        assert.equal(db.queries.some(q=>q.includes('voyage_status_history')),false);
    });
test('only historical rows actually read from SQL enter provider payload/history input audit',async()=>{
    db.state.historical=[{ id:99,declared_eta:new Date('2026-10-01T12:00:00Z'),ata:new Date('2026-10-01T13:00:00Z') }];
    await db.service().predict(1);
    const input=JSON.parse(db.state.predictions[0].input_json);
    assert.equal(input.historicalArrivals[0].voyageId,99); assert.deepEqual(input.missingFeatures,['speedKnots','weather']);
});
test('provider error saves UNAVAILABLE with null fields and restores declared ETA as effective ETA',async()=>{
    db.state.voyages[0].predicted_eta=new Date('2026-11-10T14:00:00Z'); db.state.voyages[0].ai_status='AVAILABLE';
    const result=await db.service({ adapter:{ async predict(){ throw new Error('provider down'); } } }).predict(1);
    assert.equal(result.httpStatus,200); assert.equal(result.body.aiStatus,'UNAVAILABLE');
    for(const field of ['predictedEta','etaConfidence','modelVersion','etaDeviationH']) assert.equal(result.body[field],null);
    assert.deepEqual(result.body.effectiveEta,db.state.voyages[0].declared_eta); assert.equal(db.state.voyages[0].predicted_eta,null);
});
test('provider timeout is persisted as unavailable without SQL transaction held during wait',async()=>{
    const result=await db.service({ timeoutMs:10,adapter:{ predict(){ assert.equal(db.active,0); return new Promise(()=>{}); } } }).predict(1);
    assert.equal(result.body.failureReason,'TIMEOUT'); assert.equal(db.state.predictions.length,1);
});
test('voyage not found returns 404 and does not call provider',async()=>{
    await assert.rejects(db.service({ adapter:{ predict(){ assert.fail('provider called'); } } }).predict(999),{ status:404 });
});
for(const patch of [{ validation_result:null },{ validation_result:'MISSING_DOCUMENTS' },{ status:'ANNOUNCED' },{ status:'COMPLETED' },{ status:'CANCELLED' }])
    test(`voyage not eligible ${JSON.stringify(patch)} is never promoted to VALID`,async()=>{
        Object.assign(db.state.voyages[0],patch); const before=structuredClone(db.state);
        await assert.rejects(db.service().predict(1),{ status:422,code:'VOYAGE_NOT_VALIDATED' }); assert.deepEqual(db.state,before);
    });
test('changed declared ETA during network wait is recorded DISCARDED and never overwritten',async()=>{
    const changed=new Date('2026-11-12T00:00:00Z');
    const result=await db.service({ adapter:{ async predict(){ db.state.voyages[0].declared_eta=changed; return available(); } } }).predict(1);
    assert.equal(result.httpStatus,409); assert.equal(result.body.code,'ETA_INPUT_CHANGED');
    assert.equal(result.body.attempt.applicationStatus,'DISCARDED'); assert.equal(result.body.attempt.modelVersion,'unit-model-v1');
    assert.equal(result.body.attempt.discardReason,'ETA_INPUT_CHANGED');
    assert.deepEqual(db.state.voyages[0].declared_eta,changed); assert.equal(db.state.voyages[0].latest_eta_prediction_id,null);
});
test('documents expiring before the new predicted ETA do not invalidate or rewrite UC015 state',async()=>{
    const before=structuredClone(db.state.voyages);
    const result=await db.service({ adapter:{ async predict(){ return available('2026-12-02T00:00:00Z'); } } }).predict(1);
    assert.equal(result.httpStatus,422); assert.equal(result.body.code,'DOCUMENTS_NOT_VALID_FOR_EFFECTIVE_ETA'); assert.deepEqual(db.state.voyages,before);
});
test('documents changing while waiting prevent applying the result',async()=>{
    const result=await db.service({ adapter:{ async predict(){ db.state.docs[0].review_status='REJECTED'; return available(); } } }).predict(1);
    assert.equal(result.httpStatus,422); assert.equal(db.state.voyages[0].predicted_eta,null);
});
test('re-predict creates a second audit record without duplicate lifecycle history/membership',async()=>{
    await db.service().predict(1); await db.service().predict(1);
    assert.equal(db.state.predictions.length,2); assert.equal(db.state.voyages.length,1); assert.equal(db.state.voyages[0].latest_eta_prediction_id,'2');
});
test('queue reorders with shared UC015 ETA/priority policy and preserves queued_at',async()=>{
    db.state.voyages.push(voyage(2,{ declared_eta:new Date('2026-11-10T13:00:00Z') }));
    await db.service().predict(1); assert.equal(db.state.voyages.find(v=>v.id===1).queue_position,2);
    assert.equal(db.state.voyages.find(v=>v.id===2).queue_position,1);
    assert.match(db.queries.find(q=>q.includes('sp_getapplock')),/SmartPort:UC015:queue/);
});
for(const fail of ['history','apply','reorder','result']) test(`${fail} failure rolls back history, prediction and every queue row`,async()=>{
    db.state.voyages.push(voyage(2)); const before=structuredClone(db.state); db.fail=fail;
    await assert.rejects(db.service().predict(1),new RegExp(`Injected ${fail} failure`)); assert.deepEqual(db.state,before); assert.equal(db.active,0);
});
test('concurrent requests from the same input cannot let a late result overwrite an applied result',async()=>{
    let release; let entered;
    const enteredPromise=new Promise(resolve=>{ entered=resolve; });
    const waiting=new Promise(resolve=>{ release=resolve; });
    const late=db.service({ adapter:{ async predict(){ entered(); await waiting; return available('2026-11-10T15:00:00Z'); } } }).predict(1);
    await enteredPromise; const first=await db.service().predict(1); release(); const last=await late;
    assert.equal(first.httpStatus,200); assert.equal(last.httpStatus,409); assert.equal(last.body.code,'ETA_PREDICTION_SUPERSEDED');
    assert.equal(db.state.voyages[0].predicted_eta.toISOString(),'2026-11-10T14:00:00.000Z');
    assert.equal(db.state.predictions.length,2); assert.equal(db.state.predictions[1].application_status,'DISCARDED');
});
test('history read is read-only, cursor-paginated, and available for voyages not currently VALID',async()=>{
    for(let i=1;i<=52;i++) db.state.predictions.push({ id:i,voyage_id:1,declared_eta:now,predicted_eta:null,ai_status:'UNAVAILABLE' });
    db.state.voyages[0].validation_result='MISSING_DOCUMENTS'; const before=structuredClone(db.state);
    const first=await db.service().history(1); assert.equal(first.data.length,50); assert.equal(first.nextBeforeId,'3');
    const next=await db.service().history(1,first.nextBeforeId); assert.deepEqual(next.data.map(h=>h.predictionId),['2','1']); assert.deepEqual(db.state,before);
});
test('original DB identity and missing explicit target block new workflow before writing',async()=>{
    db.badDatabase='CangThongMinh'; await assert.rejects(db.service().predict(1),{ status:503 });
    await assert.rejects(db.service({ env:{} }).history(1),{ status:503 }); assert.equal(db.state.predictions.length,0);
});
let server,base,httpDb;
before(async()=>{
    const app=express(); app.use('/api/voyages',(req,res,next)=>createVoyageEtaRouter({ sql:httpDb.sql,poolPromise:httpDb.poolPromise,
        env,policy,clock,adapter:{ async predict(){ return available(); } },logger:{ error(){} } })(req,res,next));
    server=http.createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base=`http://127.0.0.1:${server.address().port}/api/voyages`;
});
after(async()=>{ server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); });
test('Node HTTP guards, paths, invalid cursor and JSON contract',async()=>{
    httpDb=db;
    assert.equal((await fetch(`${base}/1/eta-prediction`,{ method:'POST' })).status,401);
    let response=await fetch(`${base}/1/eta-prediction`,{ method:'POST',headers:{ 'X-UC015-Key':key } });
    assert.equal(response.status,200); assert.equal((await response.json()).voyageId,1);
    response=await fetch(`${base}/1/eta-predictions`,{ headers:{ 'X-UC015-Key':key } });
    assert.equal(response.status,200); assert.equal((await response.json()).data.length,1);
    assert.equal((await fetch(`${base}/1/eta-predictions?beforeId=0`,{ headers:{ 'X-UC015-Key':key } })).status,400);
    assert.equal((await fetch(`${base}/bad/eta-prediction`,{ method:'POST',headers:{ 'X-UC015-Key':key } })).status,400);
    assert.equal((await fetch(`${base}/999/eta-prediction`,{ method:'POST',headers:{ 'X-UC015-Key':key } })).status,404);
});

test('default unconfigured integration persists only truthful UNAVAILABLE fallback',async()=>{
    const result=await db.service({ adapter:undefined }).predict(1);
    assert.equal(result.body.failureReason,'NOT_CONFIGURED'); assert.equal(result.body.predictedEta,null);
    assert.equal(result.body.etaConfidence,null); assert.equal(result.body.modelVersion,null);
});
test('VALIDATED voyage can receive a prediction without being automatically queued',async()=>{
    db.state.voyages[0].status='VALIDATED'; db.state.voyages[0].queue_position=null;
    await db.service().predict(1);
    assert.equal(db.state.voyages[0].status,'VALIDATED'); assert.equal(db.state.voyages[0].queue_position,null);
    assert.equal(db.queries.some(q=>q.includes('uc015:reorder')),false);
});
test('transaction DB identity is rechecked after external request and blocks all writes on mismatch',async()=>{
    const before=structuredClone(db.state);
    await assert.rejects(db.service({ adapter:{ async predict(){ db.badDatabase='CangThongMinh'; return available(); } } }).predict(1),{ status:503 });
    assert.deepEqual(db.state,before); assert.equal(db.active,0);
});
test('changed vessel feature is stale even when declared ETA is unchanged',async()=>{
    const result=await db.service({ adapter:{ async predict(){ db.state.voyages[0].draft=10; return available(); } } }).predict(1);
    assert.equal(result.body.code,'ETA_INPUT_CHANGED'); assert.equal(db.state.voyages[0].predicted_eta,null);
});
test('UC016 routes inherit disabled/production/key guards on POST and GET',async()=>{
    httpDb=db;
    for (const [path,method] of [['eta-prediction','POST'],['eta-predictions','GET']]) {
        assert.equal((await fetch(`${base}/1/${path}`,{ method,headers:{ 'X-UC015-Key':'wrong' } })).status,401);
        env.UC015_DEMO_ENABLED='false';
        assert.equal((await fetch(`${base}/1/${path}`,{ method,headers:{ 'X-UC015-Key':key } })).status,403);
        env.UC015_DEMO_ENABLED='true'; env.NODE_ENV='production';
        assert.equal((await fetch(`${base}/1/${path}`,{ method,headers:{ 'X-UC015-Key':key } })).status,403);
        delete env.NODE_ENV;
    }
    assert.equal(db.queries.length,0);
});
