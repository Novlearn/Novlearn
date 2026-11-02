import {expect,it,vi} from "vitest";
import type {PublicInstance} from "novlearn-exercise-engine";
import {instantiateExercise,projectPublicInstance} from "novlearn-exercise-engine";
import {compile} from "mathjs";
import {toMathJsSyntax} from "../app/utils/math/evaluation";
import {sessionExercise} from "../app/lib/engine/exerciseView";
import type {ExerciseSession} from "../app/lib/engine/learnerTypes";
vi.mock("server-only",()=>({}));
import {safeProjection} from "../app/lib/engine/guards";
it("renders prescribed Engine graph data without exposing private maths or answers",()=>{
    const n=(value:number)=>({numerator:value,denominator:1,latex:String(value)});
    const graph={id:"g",type:"function-graph" as const,formulaDomain:"unverified" as const,variable:"x",showGrid:true,window:{xMin:n(-4),xMax:n(4),yMin:n(-3),yMax:n(3)},functions:[{id:"f",latex:"x^2",color:"#3366cc",showExpression:false}]};
    const instance:PublicInstance={schemaVersion:5,instanceId:"i",title:"Courbe",elements:[graph]};
    expect(safeProjection(instance)).toBe(true);
    expect(safeProjection({...instance,elements:[{...graph,expected:"secret"}]})).toBe(false);
    const session={exerciseId:"1",metadata:{difficulty:"Moyen"},instance} as unknown as ExerciseSession;
    expect(sessionExercise(session)).toMatchObject({difficulty:"Moyen",variables:[],elements:[{type:"graph",content:{xMin:-4,xMax:4,functions:[{expression:"x^2",showExpression:false}]}}]});
});
it.each(["rational-expression","log-affine-positive","geometric-expression","elementary-positive"])("keeps the existing mathematical input for %s",kind=>{
    const session={exerciseId:"1",metadata:{},instance:{title:"Exercice",elements:[{id:"q",type:"question",text:"Calculer",response:{format:"latex",kind}}]}} as unknown as ExerciseSession;
    expect(sessionExercise(session).elements[0]).toMatchObject({type:"question",content:{answerFormat:"expression",correctAnswer:""}});
});
it("plots the Engine's real cube-root formula on both sides of zero",()=>{
    const result=instantiateExercise({schemaVersion:5,kind:"composed",id:"synthetic-graph",revision:"1",title:"Courbe réelle",generation:{schemaVersion:5,definitions:[],constraints:[],maxAttempts:1,maxDraws:1},variables:[{name:"x",domain:"real"}],elements:[{id:"g",type:"function-graph",variable:"x",window:{xMin:{latex:"-3"},xMax:{latex:"3"},yMin:{latex:"-2"},yMax:{latex:"2"}},showGrid:true,functions:[{id:"f",latex:String.raw`(x/3)\sqrt[3]{x^2}-2\sqrt[3]{x}`,color:"#3366cc",showExpression:true}]}]},{seed:42,instanceId:"synthetic"});
    if(!result.ok)throw Error(JSON.stringify(result.diagnostics));
    const graph=projectPublicInstance(result.value).elements[0];
    if(graph.type!=="function-graph")throw Error("Expected prescribed graph");
    // Presentation sampling only; answer correction always uses the server Engine.
    const plot=compile(toMathJsSyntax(graph.functions[0].latex));
    expect(plot.evaluate({x:-1}),graph.functions[0].latex).toBeCloseTo(5/3,10);
    expect(plot.evaluate({x:1})).toBeCloseTo(-5/3,10);
});
it.each([[String.raw`0{,}1x^4-1{,}8x^2+1`,2,-4.6],[String.raw`\sin(2{,}5x^2)`,1,Math.sin(2.5)]])("plots Engine decimal notation: %s",(source,x,expected)=>{
    const plot=compile(toMathJsSyntax(String(source)));
    expect(plot.evaluate({x})).toBeCloseTo(Number(expected),10);
});
