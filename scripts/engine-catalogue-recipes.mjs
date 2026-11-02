// Editorial import adapter, never a grader or evaluator. All maths stays in Engine.
import {adaptLegacyExercise,validateDefinition} from '../frontend/scripts/engine-catalogue-api.mjs';

function replaceReferences(source,names){
 return source.replace(/@([A-Za-z0-9_]+)/g,(_,name)=>{
  if(!names.has(name))throw new Error('Unknown parameter reference');
  return `\\mathrm{${names.get(name)}}`;
 });
}
export function convertCatalogueRow(original,review,{validate=validateDefinition}={}){
 const row=structuredClone(original);
 const content=typeof row.content==='string'?JSON.parse(row.content):row.content;
 const decisions=[...(review.decisions??[])];
 const rewrite=(value,transform)=>{
  if(typeof value==='string')return transform(value);
  if(Array.isArray(value))return value.map(v=>rewrite(v,transform));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,transform)]));
  return value;
 };
 for(const [name,literal]of Object.entries(review.literalChoices??{})){
  content.elements=rewrite(content.elements,s=>s.replace(new RegExp('@'+name+'(?![A-Za-z0-9_])','g'),literal));
  content.variables=content.variables.filter(v=>v.name!==name);
  decisions.push('Narrative-only choice recorded as a fixed original label; no numerical parameter removed.');
 }
 for(const [name,source]of Object.entries(review.exactDisplayParameters??{})){
  content.elements=rewrite(content.elements,s=>s.replace(new RegExp('@'+name+'(?![A-Za-z0-9_])','g'),source));
  content.variables=content.variables.filter(v=>v.name!==name);
  decisions.push('Unused numerical log approximation replaced with its exact authored display.');
 }
 content.elements=rewrite(content.elements,s=>reviewSource(s,review));
 const tupleDefinitions=[];
 content.variables=content.variables.flatMap(v=>{
  if(v.type!=='triplet')return [v];
  if(v.mode!=='choice'||!Array.isArray(v.names)||typeof v.choices!=='string')throw new Error('Unreviewed tuple source');
  const values=v.choices.split(';').map(part=>{
   const text=part.trim();if(!/^\([\d., +\-]+\)$/.test(text))throw new Error('Invalid tuple data');
   const items=text.slice(1,-1).split(',').map(x=>Number(x.trim()));
   if(items.length!==v.names.length||items.some(n=>!Number.isFinite(n)))throw new Error('Invalid tuple arity');return items;
  });
  const components=v.names.map((name,i)=>({name,kind:'integer',min:Math.min(...values.map(r=>r[i])),max:Math.max(...values.map(r=>r[i])),exclusions:[]}));
  tupleDefinitions.push({id:'legacy-tuple-'+v.id,kind:'tuple',mode:'choice',components,values});
  decisions.push('Coupled tuple rows retained as an Engine tuple choice.');
  return components.map(c=>({name:c.name,type:'integer',min:c.min,max:c.max,exclusions:'',decimals:0,choices:[],expression:''}));
 });
 for(const v of content.variables){
  if(typeof v.exclusions==='string'){
   const entries=v.exclusions.split(/[;,]/).map(x=>x.trim()).filter(Boolean);
   v.exclusions=entries.filter(e=>{
    if(!/^[+-]?\d+(?:\.\d+)?$/.test(e)||!['integer','decimal'].includes(v.type))return true;
    const n=Number(e);if(n>=v.min&&n<=v.max)return true;
    decisions.push('Removed a numeric exclusion outside its own range (no admissible value changes).');return false;
   }).join(';');
  }
  if(v.type==='computed')v.expression=reviewSource(v.expression,review);
 }
 const originals=new Map();
 const feedback=new Map();
 for(const e of content.elements){
  if(e.type==='question'||e.type==='mcq')feedback.set(String(e.id),{hint:e.content.hint,explanation:e.content.explanation});
  if(e.type==='question'){
   originals.set(String(e.id),structuredClone(e.content));
   e.content.correctAnswer='0';e.content.answerFormat='number';e.content.points=1;
  }
  if(e.type==='mcq'&&e.content.multipleAnswers!==undefined){
   const correct=e.content.options.filter(o=>o.correct).length;
   if(correct>1)e.content.multipleChoice=true;
   e.content.multipleAnswers=e.content.multipleChoice;
  }
  if(e.type==='mcq'){
   const seen=new Map();
   e.content.options=e.content.options.filter(option=>{
    const previous=seen.get(option.text);
    if(previous){
     if(previous.correct!==option.correct)throw new Error('Identical choices have contradictory correctness.');
     decisions.push('Removed an identical duplicate MCQ option with the same correctness.');return false;
    }
    seen.set(option.text,option);return true;
   });
  }
  if(e.type==='graph'){
   for(const [key,value]of Object.entries(review.graphWindow??{}))e.content[key]=value;
   for(const f of e.content.functions)f.expression=reviewSource(f.expression,review);
  }
 }
 const fakeProfiles=Object.fromEntries([...originals.keys()].map(id=>[id,{response:{format:'latex',kind:'rational'},policy:{domain:'rational',form:'value-only'}}]));
 const aliases=review.aliases??{};
 const recipe={id:review.id,revision:'1',defaults:'observed-creator-v1',variables:review.variables??[],aliases,questions:fakeProfiles,flags:{flash:'row',calculator:'row'},decisions};
 row.content=JSON.stringify(content);row.competences=JSON.stringify(row.competences??[]);
 row.Is_Flash=!!row.Is_Flash;row.Need_Calculator=!!row.Need_Calculator;row.app_title??=content.apptitle??row.title;
 const result=adaptLegacyExercise(row,'database-row-v1',recipe);
 if(!result.ok)return {ok:false,diagnostics:result.report.diagnostics,decisions};
 const definition=result.definition;
 const names=new Map(content.variables.map(v=>[v.name,aliases[v.name]??v.name]));
 for(const tuple of tupleDefinitions){
  const componentNames=new Set(tuple.components.map(c=>c.name));
  const first=definition.generation.definitions.findIndex(v=>componentNames.has(v.name));
  definition.generation.definitions=definition.generation.definitions.filter(v=>!componentNames.has(v.name));
  definition.generation.definitions.splice(first,0,tuple);
 }
 for(const q of definition.elements.filter(e=>e.type==='question')){
  const old=originals.get(q.id),profile=review.questions[q.id];
  if(!profile)throw new Error('Explicit reviewed question profile required');
  q.response=profile.response;q.policy=profile.policy;
  let source=review.expectedSources?.[q.id]??old.correctAnswer;
  source=reviewSource(source,review);
  source=replaceReferences(source,names);
  if(q.response.kind==='set')source=`\\left\\{${source.replace(/,/g,';')}\\right\\}`;
  if(q.response.kind==='intervals')source=source.replace(/,\s*(?=[+\\\-])/g,';');
  q.expectedLatex=source;
  q.points=Number.isInteger(old.points)&&old.points>0?old.points:1;
  if(q.points!==old.points)decisions.push('Historical non-integral display weight normalised to one canonical point; application scores do not use per-question weights.');
  q.extensions={legacyPath:q.extensions?.legacyPath};
 }
 for(const [questionId,fields] of feedback){
  for(const type of ['hint','explanation']){
   if(typeof fields[type]!=='string'||!fields[type].trim())continue;
   const text=fields[type].replace(/@([A-Za-z0-9_]+)/g,(_,name)=>{
    if(!names.has(name))throw new Error('Unknown feedback parameter');
    return '@'+names.get(name);
   });
   definition.elements.push({id:type+'-'+questionId,type,questionId,content:[{type:'text',text}]});
  }
 }
 for(const c of review.constraints??[])definition.generation.constraints.push(c);
 definition.catalogue.difficulty=review.difficulty;
 Object.assign(definition.catalogue,review.catalogue??{});
 definition.extensions={legacy:{adapterVersion:'staging-catalogue-reviewed-v1',original,review,decisions}};
 const checked=validate(definition);
 return checked.ok?{ok:true,definition:checked.value,decisions}:{ok:false,diagnostics:checked.diagnostics,decisions};
}
function reviewSource(source,review){
 let value=source;
 // Exact reviewed spelling changes, not algebraic rewrites or evaluation.
 for(const [from,to]of review.sourceSpellings??[])if(value===from)value=to;
 return value;
}
