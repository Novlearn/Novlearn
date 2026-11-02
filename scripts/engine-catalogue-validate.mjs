import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {convertCatalogueRow} from './engine-catalogue-recipes.mjs';
import {startLocalEngine} from './engine-pilot-local-engine.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
process.chdir(root);
const mode=process.argv[2];assert(['prepare','prepare-candidate','test'].includes(mode));
const partition=process.argv[3];assert(partition===undefined||mode==='test'&&['0','1','2','3'].includes(partition));
const releaseVersion='0.1.4';
const engine=await import(pathToFileURL(path.join(root,mode==='prepare-candidate'?'.local/engine-staging/engine-extension/dist/index.js':'frontend/node_modules/novlearn-exercise-engine/dist/index.js')));
const pointer=JSON.parse(await readFile('.local/engine-staging/catalogue-current.json','utf8'));
assert.equal(pointer.projectRef,'tksvbkvfusrnxulpahky');
const work=path.resolve(pointer.directory);assert(work.startsWith(path.join(root,'.local/engine-staging')+path.sep));
const bytes=await readFile(path.join(work,'source.private.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),pointer.sha256);
const source=JSON.parse(bytes);
let rows=[];
if(mode==='prepare'||mode==='prepare-candidate'){
 const reviews=JSON.parse(await readFile(path.join(work,'reviews.private.json'),'utf8'));
 for(const original of source.parents.filter(r=>!r.catalog_id)){
  let record={id:original.id,title:original.title};
  try{
   const result=convertCatalogueRow(original,reviews[original.id],{validate:engine.validateDefinition});
   record={...record,...result};
   if(result.ok){
    const instance=engine.instantiateExercise(result.definition,{seed:42,instanceId:'prepare-'+original.id});
    record.instantiated=instance.ok;
    if(!instance.ok)record.diagnostics=instance.diagnostics;
   }
  }catch(error){record.ok=false;record.diagnostics=[{path:'',message:error.message}];}
  rows.push(record);
  if(rows.length%10===0)console.log(JSON.stringify({processed:rows.length,contracts:rows.filter(r=>r.ok).length,instantiated:rows.filter(r=>r.instantiated).length}));
 }
 await writeFile(path.join(work,'candidates.private.json'),JSON.stringify({projectRef:pointer.projectRef,sourceHash:pointer.sha256,rows},null,2)+'\n');
}else{
 rows=JSON.parse(await readFile(path.join(work,'candidates.private.json'),'utf8')).rows.filter(r=>partition===undefined||r.id%4===Number(partition));
 const release=JSON.parse(await readFile(`frontend/vendor/engine-release-${releaseVersion}.json`,'utf8'));
 const resultFile=partition===undefined?'qualified.private.json':`qualified-${releaseVersion}-${partition}.private.json`;
 if(partition!==undefined){
  let previous;
  try{previous=JSON.parse(await readFile(path.join(work,resultFile),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous){
   assert.equal(previous.sourceHash,pointer.sha256);assert.equal(previous.archiveSha256,release.archiveSha256);
   for(const row of rows){const old=previous.rows.find(p=>p.id===row.id);if(old?.qualified&&JSON.stringify(old.definition)===JSON.stringify(row.definition)){row.tests=old.tests;row.qualified=true;}}
  }
 }
 const hostRoot=path.join(work,'qualification-'+Date.now());await mkdir(hostRoot);
 const host=await startLocalEngine(hostRoot,{port:partition==='0'?3155:partition===undefined?3152:3151+Number(partition),releaseVersion});
 const run=async(operation,payload)=>{
  const requestId=randomUUID();
  const response=await fetch(host.environment.NOVLEARN_ENGINE_LOCAL_URL,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+host.environment.NOVLEARN_ENGINE_LOCAL_CAPABILITY},body:JSON.stringify({protocolVersion:1,requestId,operation,payload}),signal:AbortSignal.timeout(15000)});
  const r=await response.json();assert.equal(r.requestId,requestId);if(!r.ok)throw new Error('Bounded Engine operation failed');return r.value;
 };
 try{
  let processed=0;
  for(const row of rows){
   if(!row.instantiated||row.qualified)continue;
   row.tests=[];
   for(const seed of [0,1,42,123,4294967295]){
    const result={seed,generated:false,publicProjection:false,questions:[]};
    try{
     const official=await run('instantiateExercise',{definition:row.definition,seed,instanceId:randomUUID()});
     if(!official.ok){result.diagnostics=official.diagnostics;row.tests.push(result);continue;}
     result.generated=true;
     result.official=official.value;
     const publicInstance=await run('projectPublicInstance',{official:official.value});
     result.publicProjection=!/"(?:expected|policy|definition|generation|extensions)"\s*:/.test(JSON.stringify(publicInstance));
     for(const q of official.value.elements.filter(e=>e.type==='question'||e.type==='mcq')){
      const expected=q.type==='mcq'?{format:'selection',optionIds:q.expected.optionIds}:q.expected.kind==='text'?{format:'text',source:q.expected.variants[0]}:{format:'latex',source:q.expected.math.displayLatex};
      const base={schemaVersion:5,instanceId:official.value.instanceId,questionId:q.id};
      const correct=await run('gradeAnswer',{official:official.value,submission:{...base,answer:expected}});
      const invalid=await run('gradeAnswer',{official:official.value,submission:{...base,answer:q.type==='mcq'?{format:'selection',optionIds:[]}:{format:'latex',source:''}}});
      const wrongAnswer=q.type==='mcq'?{format:'selection',optionIds:q.options.filter(o=>!q.expected.optionIds.includes(o.id)).slice(0,q.mode==='single'?1:undefined).map(o=>o.id)}:q.expected.kind==='text'?{format:'text',source:'Réponse volontairement différente.'}:['set','intervals'].includes(q.response.kind)?{format:'latex',source:'\\emptyset'}:{format:'latex',source:q.expected.math.displayLatex.includes('infty')?(q.expected.math.displayLatex.startsWith('-')?'\\infty':'-\\infty'):q.response.kind==='rational-expression'?`-(${q.expected.math.displayLatex})`:`(${q.expected.math.displayLatex})+1`};
      const wrong=await run('gradeAnswer',{official:official.value,submission:{...base,answer:wrongAnswer}});
      result.questions.push({id:q.id,correct:correct.state,correctCode:correct.code,empty:invalid.state,wrong:wrong.state,wrongCode:wrong.code});
     }
     if(seed===42){const replay=await run('instantiateExercise',{definition:row.definition,seed,instanceId:official.value.instanceId});result.replay=replay.ok&&JSON.stringify(replay.value)===JSON.stringify(official.value);}
    }catch{result.error='bounded-operation-unavailable';}
    row.tests.push(result);
   }
   row.qualified=row.tests.length===5&&row.tests.every(t=>t.generated&&t.publicProjection&&(t.seed!==42||t.replay)&&t.questions.every(q=>q.correct==='correct'&&q.empty==='invalid'&&q.wrong==='incorrect'));
   processed++;
   await writeFile(path.join(work,resultFile),JSON.stringify({projectRef:pointer.projectRef,sourceHash:pointer.sha256,archiveSha256:release.archiveSha256,rows},null,2)+'\n');
   console.log(JSON.stringify({processed,id:row.id,qualified:row.qualified}));
  }
 }finally{await host.close();}
}
const summary={total:rows.length,contracts:rows.filter(r=>r.ok).length,instantiated:rows.filter(r=>r.instantiated).length,qualified:rows.filter(r=>r.qualified).length,blocked:rows.filter(r=>!r.instantiated).map(r=>({id:r.id,diagnostics:r.diagnostics}))};
await writeFile(path.join(work,partition===undefined?'summary.json':`summary-${releaseVersion}-${partition}.json`),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
