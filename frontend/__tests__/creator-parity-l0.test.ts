import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate } from "../app/utils/math/evaluation";
import { generateVariables } from "../app/utils/variableGenerator";
import type { Variable } from "../app/types/exercise";

// Optional sibling checkout: no copy of Creator implementation, no private catalogue execution.
// Failures in an available checkout fail the suite; absence is an explicit skipped suite.
const creatorRoot = resolve(process.cwd(), "../../Novlearn Creator/src/utils");
const available = existsSync(resolve(creatorRoot,"generateRandomValues.js"));
function loadCreator(filename: string, cache = new Map<string, {exports: any}>()): any {
  const path = resolve(creatorRoot,filename);
  if (cache.has(path)) return cache.get(path)!.exports;
  const module = {exports:{}};
  cache.set(path,module);
  const source = readFileSync(path,"utf8");
  const compiled = ts.transpileModule(source, {compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,
  }}).outputText;
  const localRequire = (specifier: string) => {
    if (!specifier.startsWith("./")) throw new Error("Unexpected Creator dependency: "+specifier);
    return loadCreator(resolve(dirname(path),specifier)+(specifier.endsWith(".js")?"":".js"),cache);
  };
  new Function("require","module","exports",compiled)(localRequire,module,module.exports);
  return module.exports;
}
afterEach(() => vi.restoreAllMocks());
describe.skipIf(!available)("L0 / real sibling Creator parity on synthetic parameters", () => {
  it("calculator equality on elementary expressions", () => {
    const {evalMath} = loadCreator("mathExpr.js");
    for (const expr of ["1/2","2^3^2","sqrt(4)","2(3+1)"]) {
      expect(evalMath(expr)).toBe(evaluate(expr));
    }
  });
  it("characterizes negative parameter divergence", () => {
    const {evalMath} = loadCreator("mathExpr.js");
    expect(evalMath("@a^2",{a:-2})).toBe(4);
    expect(evaluate("@a^2",{a:-2})).toBe(-4);
  });
  it("characterizes comma-separated argument divergence", () => {
    const {evalMath} = loadCreator("mathExpr.js");
    expect(evalMath("max(1,2)")).toBe(2);
    expect(evaluate("max(1,2)")).toBe(1.2);
  });
  it("replays the same simple integer/computed instance in both generators", () => {
    const {generateRandomValues} = loadCreator("generateRandomValues.js");
    vi.spyOn(Math,"random").mockReturnValue(0);
    const defs: Variable[]=[{id: 1, name:"a",type:"integer",min:-2,max:2},
      {id: 1, name:"square",type:"computed",expression:"@a^2"}];
    expect(generateRandomValues(defs)).toEqual(generateVariables(defs));
  });
  it("characterizes Creator helper missing in the app", () => {
    const {generateRandomValues} = loadCreator("generateRandomValues.js");
    const defs: Variable[]=[{id: 1, name:"a",type:"integer",min:1,max:1},
      {id: 1, name:"b",type:"integer",min:-3,max:-3},{id: 1, name:"c",type:"integer",min:2,max:2},
      {id: 1, name:"r",type:"computed",expression:"root1(@a,@b,@c)"}];
    expect(generateRandomValues(defs).r).toBe(1);
    expect(generateVariables(defs)).not.toHaveProperty("r");
  });
  it("characterizes root naming for a negative leading coefficient", () => {
    const {mathModules} = loadCreator("mathmodules.js");
    expect(mathModules.root1(-1,0,1)).toBe(1);
    expect(mathModules.root2(-1,0,1)).toBe(-1);
  });
  it("characterizes ln computed divergence found in catalogue vocabulary", () => {
    const {generateRandomValues} = loadCreator("generateRandomValues.js");
    const defs: Variable[]=[{id:1,name:"a",type:"integer",min:2,max:2},
      {id:2,name:"r",type:"computed",expression:"ln(@a)"}];
    expect(generateRandomValues(defs)).not.toHaveProperty("r");
    expect(generateVariables(defs).r).toBeCloseTo(Math.log(2));
  });
  it("a Creator numerical solver can return a non-root for x*x+1", () => {
    const {mathModules} = loadCreator("mathmodules.js");
    const result = mathModules.solve("x*x+1",0);
    expect(Number.isFinite(result)).toBe(true);
    expect(result*result+1).toBeGreaterThanOrEqual(1);
  });
});
