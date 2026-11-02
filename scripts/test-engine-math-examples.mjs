// Synthetic arithmetic checks against the exact Engine installed by NovLearn.
// No database, learner answer or replacement evaluator is used here.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { instantiateExercise, projectPublicInstance, gradeAnswer } from '../frontend/node_modules/novlearn-exercise-engine/dist/index.js';

const base = JSON.parse(await readFile(new URL('../frontend/__tests__/fixtures/engine-pilot-definition.json',import.meta.url),'utf8'));
const cases = [
  {name:'division-4-par-2',formula:'a/b',values:{a:4,b:2},correct:['2','4/2','\\frac{4}{2}'],wrong:['3','0.5']},
  {name:'fraction-exacte',formula:'a/b',values:{a:1,b:3},correct:['1/3','\\frac{1}{3}'],wrong:['0.3333']},
  {name:'signe-et-parentheses',formula:'a-b',values:{a:2,b:-3},correct:['5','2-(-3)'],wrong:['-1']},
  {name:'multiplication-implicite',formula:'2a',values:{a:-3},correct:['-6','2\\times(-3)'],wrong:['6']},
  {name:'somme-decimale-exacte',formula:'a/10+b/10',values:{a:1,b:2},correct:['0.3','3/10'],wrong:['0.300001']},
];
const results=[];
for(const c of cases){
  const definition=structuredClone(base);
  definition.generation.definitions=Object.entries(c.values).map(([name,value])=>({name,kind:'integer',min:value,max:value,exclusions:[]}));
  definition.generation.constraints=[];definition.variables=[];
  definition.elements=[{id:'formula',type:'expression',latex:c.formula},{id:'q',type:'question',text:'Calculer la valeur exacte.',points:1,response:{format:'latex',kind:'rational'},expectedLatex:c.formula,policy:{domain:'rational',form:'value-only'}}];
  const instance=instantiateExercise(definition,{seed:42,instanceId:'synthetic-'+c.name});
  assert.equal(instance.ok,true,c.name+': instantiation failed');
  const official=instance.value;
  const grade=source=>gradeAnswer(official,{schemaVersion:5,instanceId:official.instanceId,questionId:'q',answer:{format:'latex',source}});
  for(const source of c.correct) assert.equal(grade(source).state,'correct',c.name+': equivalent answer rejected');
  for(const source of c.wrong) assert.equal(grade(source).state,'incorrect',c.name+': incorrect answer accepted');
  assert.equal(grade('').state,'invalid');
  results.push({name:c.name,formula:c.formula,values:c.values,displayLatex:projectPublicInstance(official).elements[0].latex,correctAnswers:c.correct.length,incorrectAnswers:c.wrong.length,emptyInput:'invalid'});
}
const undefinedDefinition=structuredClone(base);
undefinedDefinition.generation.definitions=[];undefinedDefinition.generation.constraints=[];undefinedDefinition.variables=[];
undefinedDefinition.elements=[{id:'formula',type:'expression',latex:'4/0'}];
assert.equal(instantiateExercise(undefinedDefinition,{seed:42,instanceId:'synthetic-division-zero'}).ok,false);
const proof={date:'2026-11-02',scope:'Official installed Engine core; synthetic definitions, no database or deployment qualification',packageVersion:'0.1.1',cases:results,divisionByZeroRejected:true};
await writeFile(new URL('../docs/audits/2026-11-engine-math-examples.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));
