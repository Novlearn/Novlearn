import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({writes: [] as {operation:string,payload?:unknown}[], from:vi.fn(), getUser:vi.fn()}));
vi.mock("../app/lib/supabase",()=>({supabase:{from:db.from,auth:{getUser:db.getUser}}}));
vi.mock("../app/contexts/AuthContext",()=>({useAuth:()=>({isGuest:false})}));
vi.mock("../app/hooks/useGuestMode",()=>({GUEST_EXERCISE_LIMIT:5,useGuestMode:()=>({getGuestAttemptCount:vi.fn()})}));
vi.mock("../app/store/useTaxonomyStore",()=>({useTaxonomyStore:()=>((id:string)=>id)}));
vi.mock("../app/components/ui/FeedbackModal",()=>({FeedbackModal:()=>null}));
vi.mock("../app/components/ui/HelpModal",()=>({HelpModal:()=>null}));
vi.mock("../app/components/Exercise/ExerciseRenderer",()=>({default:(props:any)=><div data-testid="renderer" {...({onElementSubmit:props.onElementSubmit} as any)}/>}));
import ExerciseLoader from "../app/components/Exercise/ExerciseLoader";
let mounted: ReactTestRenderer | undefined;
beforeEach(()=>{
  db.writes.length=0;
  db.getUser.mockResolvedValue({data:{user:{id:"synthetic"}}});
  db.from.mockImplementation((table:string)=>{
    const result={data:table==="exercises"?{id:1,title:"Synthetic",difficulty:"easy",competences:[],content:{
      variables:[],elements:[{id:1,type:"question",content:{correctAnswer:"2",answerFormat:"number"}}]}}:{id:7},error:null};
    const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:()=>Promise.resolve(result),single:()=>Promise.resolve(result),
      insert:(payload:unknown)=>{db.writes.push({operation:"insert",payload});return chain;},
      update:(payload:unknown)=>{db.writes.push({operation:"update",payload});return chain;},
      delete:()=>{db.writes.push({operation:"delete"});return chain;},
      then:(ok:any,fail:any)=>Promise.resolve(result).then(ok,fail)};
    return chain;
  });
});
afterEach(()=>{ if(mounted) act(()=>mounted!.unmount()); mounted=undefined; vi.restoreAllMocks(); });
async function mount(props: Record<string,unknown>={}) {
  await act(async()=>{mounted=create(<ExerciseLoader exerciseId="1" {...props}/>);});
  return mounted!;
}
describe("L0 / real loader, persistence and child renderer mocked",()=>{
  it("Passer before any answer calls onNextClick(false)",async()=>{
    const next=vi.fn().mockResolvedValue(undefined);const r=await mount({onNextClick:next});
    const skip=r.root.findAllByType("button").find(b=>b.children.includes("Passer"))!;
    await act(async()=>{await skip.props.onClick();});
    expect(next.mock.calls).toEqual([[false]]);
    expect(db.writes).toEqual([]);
  });
  it("trackAbandon inserts false at load and leaves it at unmount",async()=>{
    await mount({trackAbandon:true});
    expect(db.writes).toEqual([{operation:"insert",payload:{user_id:"synthetic",exercise_id:1,is_correct:false,is_abandoned:true,is_guest:false}}]);
    act(()=>mounted!.unmount());mounted=undefined;
    expect(db.writes).toHaveLength(1);
  });
  it("Passer deletes a pending attempt and still reports no errors",async()=>{
    const next=vi.fn().mockResolvedValue(undefined);const r=await mount({trackAbandon:true,onNextClick:next});
    const skip=r.root.findAllByType("button").find(b=>b.children.includes("Passer"))!;
    await act(async()=>{await skip.props.onClick();});
    expect(db.writes.map(w=>w.operation)).toEqual(["insert","delete"]);
    expect(next.mock.calls).toEqual([[false]]);
  });
  it("completion updates the pending row rather than inserting a finalized one",async()=>{
    const r=await mount({trackAbandon:true});
    await act(async()=>{r.root.findByProps({"data-testid":"renderer"}).props.onElementSubmit(1,"2",true);});
    expect(db.writes).toHaveLength(2);
    expect(db.writes[1]).toEqual({operation:"update",payload:{is_correct:true,is_abandoned:false}});
  });
  it("normal mode persists one finalized result",async()=>{
    const r=await mount();
    await act(async()=>{r.root.findByProps({"data-testid":"renderer"}).props.onElementSubmit(1,"wrong",false);});
    expect(db.writes).toEqual([{operation:"insert",payload:{user_id:"synthetic",exercise_id:1,is_correct:false,time_spent:null,is_guest:false}}]);
  });
});
