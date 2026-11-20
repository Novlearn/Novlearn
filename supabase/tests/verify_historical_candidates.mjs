// Review-only release check. Never binds identities or approves a manifest.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import {validateDefinition} from '../../frontend/node_modules/novlearn-exercise-engine/dist/index.js';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const identities=read(path.resolve('../Novlearn-admin/.local/catalogue-production-exercise-correspondences.json'));
const definitions=read('.local/catalogue-production-historical-execution-candidates.json');
const rehearsal=read('.local/production-transition/latest.json');
assert.equal(identities.approved,false);assert.equal(definitions.approved,false);
const results=[];
for(const item of identities.items){
 const candidates=definitions.items.filter(d=>d.source_id===item.stagingId&&d.catalog_id===item.stagingCatalogId);
 assert.equal(candidates.length,1);const candidate=candidates[0];
 const original=JSON.stringify(candidate.definition.extensions.legacy.original).replaceAll("'","''");
 const r=spawnSync('docker',['exec','-i','novlearn-transition-20261113','psql','-X','-q','-At','-U','supabase_admin','-d',rehearsal.targetDB,'-v','ON_ERROR_STOP=1'],
 {input:`SELECT encode(extensions.digest(convert_to(novlearn_admin_private.historical_projection('${original}'::jsonb)::text,'UTF8'),'sha256'),'hex');`,encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0,r.stderr);
 results.push({productionId:item.productionId,originalFingerprintMatches:r.stdout.trim()===item.historicalFingerprint,
  provenanceVerified:candidate.provenance_verified,validDefinition:validateDefinition(candidate.definition).ok,approved:false});
}
const failed=results.filter(r=>!r.originalFingerprintMatches||!r.provenanceVerified||!r.validDefinition);
writeFileSync('.local/catalogue-production-historical-definition-validation.json',JSON.stringify({archive:'0.2.1',checked:results.length,failed,results,approved:false},null,2));
assert.equal(failed.length,0,`${failed.length} candidate definitions require review`);
console.log(`PASS ${results.length} historical fingerprints, provenance proofs and Engine 0.2.1 definition contracts; approved=false`);
