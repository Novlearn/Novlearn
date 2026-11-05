import {afterEach,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
vi.mock("colyseus",()=>({Room:class {broadcast=vi.fn();}}));
vi.mock("../src/db",()=>({supabase:{},verifySupabaseToken:vi.fn(),getDuel:vi.fn(),getPlayerName:vi.fn(),getRandomExercise:vi.fn(),saveDuelResult:vi.fn(),recordAttempt:vi.fn().mockResolvedValue(undefined)}));
import {engineRun} from "../src/engine";
import {recordAttempt} from "../src/db";
import {DuelRoom} from "../src/rooms/DuelRoom";
afterEach(()=>vi.restoreAllMocks());
it("uses the real bounded Engine verdict in the duel room, including 4/2=2",async()=>{
 vi.spyOn(console,"log").mockImplementation(()=>{});
 const definition=JSON.parse(readFileSync(new URL('../../frontend/__tests__/fixtures/engine-pilot-definition.json',import.meta.url),'utf8'));
 definition.generation.definitions=[];definition.generation.constraints=[];definition.variables=[];
 definition.elements=[{id:"q",type:"question",text:"Calculer 4/2",points:1,response:{format:"latex",kind:"rational"},expectedLatex:"4/2",policy:{domain:"rational",form:"value-only"}}];
 const generated=await engineRun("instantiateExercise",{definition,seed:42,instanceId:"bounded-duel"});
 expect(generated.ok,JSON.stringify(generated.diagnostics)).toBe(true);
 const room=new DuelRoom(),internal=room as any;
 room.state.phase="playing";room.state.player1Id="p1";room.state.player2Id="p2";
 internal.duelId=1;internal.engineRound={id:"bounded-duel",questionId:"q",official:generated.value};
 const client={userData:{userId:"p1"},send:vi.fn()};
 const submit=(source:string,isCorrect:boolean)=>internal.handleSubmitAnswer(client,{requestId:source||"empty",instanceId:"bounded-duel",questionId:"q",rawAnswer:{format:"latex",source},isCorrect});
 try{
  await submit("",true);expect(recordAttempt).not.toHaveBeenCalled();expect(room.state.player1Score).toBe(0);
  await submit("999",true);expect(room.state.player1Score).toBe(0);expect(recordAttempt).toHaveBeenLastCalledWith(1,"p1",1,expect.any(String),false,expect.any(Number),"bounded-duel");
  await submit("2",false);expect(room.state.player1Score).toBe(1);expect(recordAttempt).toHaveBeenLastCalledWith(1,"p1",1,expect.any(String),true,expect.any(Number),"bounded-duel");
  await submit("2",true);expect(room.state.player1Score).toBe(1);expect(recordAttempt).toHaveBeenCalledTimes(2);
 }finally{internal.clearAllTimers();}
});
