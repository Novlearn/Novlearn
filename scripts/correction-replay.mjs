import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const privateRoot=resolve(root,".local/exercise-correction");
const require=createRequire(resolve(root,"frontend/package.json"));
const ts=require("typescript");
const cache=new Map();
function load(path) {
  path=resolve(path);
  if(cache.has(path))return cache.get(path).exports;
  const module={exports:{}};cache.set(path,module);
  const source=readFileSync(path,"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  new Function("require","module","exports",code)(s=>s.startsWith(".")?load(resolve(dirname(path),s)+".ts"):require(s),module,module.exports);
  return module.exports;
}
function randomTape(seed) {
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
try {
  const latest=JSON.parse(await readFile(resolve(privateRoot,"latest.json"),"utf8"));
  if(!/^[\w.-]+\.manifest\.json$/.test(latest.manifest))throw Error();
  const manifest=JSON.parse(await readFile(resolve(privateRoot,latest.manifest),"utf8"));
  if(!/^[\w.-]+\.json$/.test(manifest.snapshot))throw Error();
  const raw=await readFile(resolve(privateRoot,manifest.snapshot),"utf8");
  if(createHash("sha256").update(raw).digest("hex")!==manifest.sha256)throw Error();
  const rows=JSON.parse(raw);
  const {generateVariables}=load(resolve(root,"frontend/app/utils/variableGenerator.ts"));
  const originalRandom=Math.random, originalWarn=console.warn;
  const seeds=[1,42,2026,90709,4294967295];
  const results=[];
  try {
    for(const row of rows) for(const seed of seeds) {
      const definitions=row.content?.variables??[];
      let warnings=0;
      const replay=()=>{Math.random=randomTape(seed);console.warn=()=>{warnings++;};return generateVariables(definitions);};
      const values=replay(), again=replay();
      const missing=definitions.flatMap(v=>["doublet","triplet"].includes(v.type)?v.names??[]:[v.name]).filter(n=>!(n in values));
      const forbidden=[];
      // Independent constraint check, limited to static numeric exclusions only.
      // Dynamic constraints/domains remain for pedagogical/reference review.
      for(const v of definitions) {
        const exclusions=typeof v.exclusions==="string"?v.exclusions.split(/[;,]/):v.exclusions??[];
        for(const x of exclusions) {
          if(String(x).trim() && /^[-+]?\d+(?:\.\d+)?$/.test(String(x).trim()) && Number(values[v.name])===Number(x)) forbidden.push(v.name);
        }
      }
      results.push({exerciseId:String(row.id),seed,values,missing,forbidden,warnings,
        deterministic:JSON.stringify(values)===JSON.stringify(again)});
    }
  } finally {Math.random=originalRandom;console.warn=originalWarn;}
  const summary={snapshotSha256:manifest.sha256,seeds,instances:results.length,
    nondeterministic:results.filter(r=>!r.deterministic).length,
    incomplete:results.filter(r=>r.missing.length).length,
    staticExcludedValue:results.filter(r=>r.forbidden.length).length,
    exhaustionWarnings:results.reduce((sum,r)=>sum+r.warnings,0),
    limits:"Generation only; no mathematical or pedagogical certification. Warnings include both replay runs."};
  await writeFile(resolve(privateRoot,"generation-replay.json"),JSON.stringify({version:1,summary,results},null,2)+"\n");
  console.log(JSON.stringify(summary,null,2));
  if(summary.nondeterministic)process.exitCode=1;
} catch {console.error("PRIVATE_REPLAY_FAILED; verify snapshot, dependencies and local modules.");process.exitCode=1;}
