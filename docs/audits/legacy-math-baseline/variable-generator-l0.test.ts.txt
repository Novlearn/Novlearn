import { afterEach, describe, expect, it, vi } from "vitest";
import { generateVariables } from "../app/utils/variableGenerator";
import type { Variable } from "../app/types/exercise";

afterEach(() => vi.restoreAllMocks());
describe("L0 / real generator with deterministic random tape", () => {
  it("replays integer, decimal, choice, triplet and computed values", () => {
    const defs: Variable[] = [
      { id: 1, name: "a", type: "integer", min: -2, max: 2 },
      { id: 1, name: "d", type: "decimal", min: 0, max: 1, decimals: 2 },
      { id: 1, name: "c", type: "choice", choices: ["2", "3"] },
      { id: 1, name: "tuple", type: "triplet", mode: "choice", names: ["u", "v", "w"], choices: "(1,2,3);(4,5,6)" },
      { id: 1, name: "square", type: "computed", expression: "@a^2" },
      { id: 1, name: "after", type: "computed", expression: "@square+1" },
    ];
    const replay = () => {
      const tape = [0, 0.123, 0.75, 0.75];
      let index = 0;
      vi.spyOn(Math, "random").mockImplementation(() => {
        if (index >= tape.length) throw new Error("unexpected random draw");
        return tape[index++];
      });
      const result = generateVariables(defs);
      expect(index).toBe(4);
      vi.restoreAllMocks();
      return result;
    };
    expect(replay()).toEqual({a:-2,d:0.12,c:"3",u:4,v:5,w:6,square:4,after:5});
    expect(replay()).toEqual(replay());
  });
  it("rejects an excluded draw when supplied as an array", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValue(0.99);
    expect(generateVariables([{id: 1, name:"a",type:"integer",min:0,max:1,exclusions:[0]}])).toEqual({a:1});
  });
  it("characterizes forbidden fallback after exhaustion", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(generateVariables([{id: 1, name:"a",type:"integer",min:0,max:0,exclusions:[0]}])).toEqual({a:0});
    expect(warning).toHaveBeenCalledOnce();
  });
  it.fails("an impossible exclusion must not generate a forbidden value", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(generateVariables([{id: 1, name:"a",type:"integer",min:0,max:0,exclusions:[0]}])).not.toHaveProperty("a",0);
  });
  it("characterizes legacy dynamic string exclusion from persisted JSON", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const defs = [{id: 1, name:"a",type:"integer",min:2,max:2},
      {id: 1, name:"b",type:"integer",min:2,max:3,exclusions:"@a"}] as unknown as Variable[];
    expect(generateVariables(defs)).toEqual({a:2,b:2});
  });
  it.fails("a dynamic exclusion must exclude the previous parameter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const defs = [{id: 1, name:"a",type:"integer",min:2,max:2},
      {id: 1, name:"b",type:"integer",min:2,max:3,exclusions:"@a"}] as unknown as Variable[];
    expect(generateVariables(defs).b).not.toBe(2);
  });
  it("characterizes unresolved computed dependencies without throwing", () => {
    expect(generateVariables([{id: 1, name:"r",type:"computed",expression:"@missing+1"}])).toEqual({});
  });
  it.todo("decide error contract for cycles, impossible exclusions and missing dependencies");
});
