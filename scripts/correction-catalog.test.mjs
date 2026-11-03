import test from "node:test";
import assert from "node:assert/strict";
import { inventory, parseEnv } from "./correction-catalog.mjs";

test("configuration parsing preserves quoted secrets without evaluating text", () => {
  assert.deepEqual(parseEnv("# comment\nA='literal $x'\nexport B=second\n"), {A:"literal $x", B:"second"});
});
test("inventory observes legacy types and conventions without evaluating author expressions", () => {
  const rows = [{id:1, Is_Flash:true, Need_Calculator:false, content:{
    variables:[{name:"a",type:"integer",exclusions:"0;1"},
      {name:"r",type:"computed",expression:"solve('x*x+1',0)"}],
    elements:[{id:1,type:"question",content:{answer:"2",answerType:"set",points:2}},
      {id:2,type:"complexPlane",content:{}}]}}];
  const result = inventory(rows);
  assert.equal(result.exercises,1);
  assert.equal(result.conventions.string_exclusions,1);
  assert.equal(result.conventions.legacy_answer,1);
  assert.equal(result.answerFormats.set,1);
  assert.equal(result.computedFunctions.solve,1);
  assert.equal(result.structuralIssues.unsupported_element_type,1);
  assert.equal(result.flags.flash,1);
});
test("malformed content and duplicated identifiers are counted", () => {
  const result = inventory([{id:1,content:null}, {id:2,content:{
    variables:"invalid",elements:[{id:1,type:"text",content:{}},{id:1,type:"question",content:{}}]}}]);
  assert.equal(result.structuralIssues.invalid_content,1);
  assert.equal(result.structuralIssues.variables_not_array,1);
  assert.equal(result.structuralIssues.duplicate_element_id,1);
  assert.equal(result.structuralIssues.missing_expected_answer,1);
});
test("JSON numeric precision risk is reported", () => {
  assert.equal(inventory([{id:Number.MAX_SAFE_INTEGER+1,content:{elements:[]}}]).unsafeIds,1);
});
