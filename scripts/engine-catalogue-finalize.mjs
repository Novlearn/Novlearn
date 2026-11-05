// Reconcile the four bounded runs without importing private catalogue data into Git.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const pointer=JSON.parse(await readFile('.local/engine-staging/catalogue-current.json','utf8'));
assert.equal(pointer.projectRef,'tksvbkvfusrnxulpahky');
const work=path.resolve(pointer.directory);assert(work.startsWith(path.resolve('.local/engine-staging')+path.sep));
const release=JSON.parse(await readFile('frontend/vendor/engine-release-0.1.4.json','utf8'));
const candidates=JSON.parse(await readFile(path.join(work,'candidates.private.json'),'utf8'));
const rows=[];
for(let partition=0;partition<4;partition++){
 const report=JSON.parse(await readFile(path.join(work,`qualified-0.1.4-${partition}.private.json`),'utf8'));
 assert.equal(report.projectRef,pointer.projectRef);assert.equal(report.sourceHash,pointer.sha256);assert.equal(report.archiveSha256,release.archiveSha256);
 for(const row of report.rows){
  assert.equal(row.id%4,partition);assert(row.ok&&row.instantiated&&row.qualified);
  assert.equal(JSON.stringify(row.definition),JSON.stringify(candidates.rows.find(c=>c.id===row.id)?.definition),'Definition changed after qualification');
  assert.deepEqual(row.tests.map(t=>t.seed),[0,1,42,123,4294967295]);
  assert(row.tests.every(t=>t.generated&&t.publicProjection&&(t.seed!==42||t.replay)&&t.questions.every(q=>q.correct==='correct'&&q.wrong==='incorrect'&&q.empty==='invalid')));
  rows.push(row);
 }
}
assert.equal(rows.length,111);assert.equal(new Set(rows.map(r=>r.id)).size,111);rows.sort((a,b)=>a.id-b.id);
const privateReport={projectRef:pointer.projectRef,sourceHash:pointer.sha256,archiveSha256:release.archiveSha256,rows};
const bytes=JSON.stringify(privateReport,null,2)+'\n';
await writeFile(path.join(work,'qualified-final.private.json'),bytes);
const proof={date:new Date().toISOString(),projectRef:pointer.projectRef,sourceSha256:pointer.sha256,archiveSha256:release.archiveSha256,packageVersion:release.packageVersion,exercises:rows.length,generations:rows.reduce((n,r)=>n+r.tests.length,0),deterministicReplays:rows.length,correctAnswers:rows.reduce((n,r)=>n+r.tests.reduce((s,t)=>s+t.questions.length,0),0),incorrectAnswers:rows.reduce((n,r)=>n+r.tests.reduce((s,t)=>s+t.questions.length,0),0),emptyInputs:rows.reduce((n,r)=>n+r.tests.reduce((s,t)=>s+t.questions.length,0),0),privateReportSha256:createHash('sha256').update(bytes).digest('hex'),scope:'Exact bounded Linux archive: generation, public projection, correct/incorrect/empty answers and deterministic replay. Separate from independent pedagogical review and browser reception.',ids:rows.map(r=>r.id)};
await mkdir('.local/engine-staging',{recursive:true});
await writeFile('.local/engine-staging/catalogue-qualification-summary.json',JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({...proof,ids:undefined}));
