import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
 process.env.APP_ENV='production';
 process.env.SUPABASE_URL='https://abwipnppcrghdhwriyjp.supabase.co';
 process.env.SUPABASE_SERVICE_KEY='synthetic-local-only';
 process.env.PRODUCTION_CATALOG_SYNC_ENFORCED='false';
 return { rows:[] as any[], versions:[] as any[], reserved:[] as any[], requests:[] as URL[] };
});
vi.mock('@supabase/supabase-js', async original => {
 const real=await original<typeof import('@supabase/supabase-js')>();
 return {...real,createClient:(url:string,key:string)=>real.createClient(url,key,{auth:{persistSession:false},global:{fetch:async input=>{
  const request=new URL(String(input)); fixture.requests.push(request);
  const table=request.pathname.split('/').at(-1);
  let data:any=table==='duel_catalog_reservations'?fixture.reserved:table==='exercise_versions'?fixture.versions:fixture.rows;
  if(table==='exercises') {
   expect(request.searchParams.get('select')).toContain('legacy_version_id');
   if(request.searchParams.get('admin_archived_at')==='is.null') data=data.filter((r:any)=>!r.admin_archived_at);
   if(request.searchParams.has('id'))data=data.find((r:any)=>String(r.id)===request.searchParams.get('id')!.slice(3));
  }
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 }}})};
});
import { getRandomExercise } from '../db';
afterEach(()=>{fixture.rows=[];fixture.versions=[];fixture.reserved=[];fixture.requests=[];});

it('keeps unassociated history usable through the reviewed historical execution version',async()=>{
 fixture.rows=[{id:1,catalog_id:null,active_version_id:null,legacy_version_id:'history'}];
 fixture.versions=[{id:'history',exercise_id:1,revision:0,editorial_status:'published',elements:[{type:'question'}]}];
 expect(await getRandomExercise(7)).toMatchObject({row:{id:1},versionId:'history'});
 expect(fixture.requests.find(r=>r.pathname.endsWith('/exercises'))!.searchParams.get('or')).toBe('(active_version_id.not.is.null,legacy_version_id.not.is.null)');
});
it('selects the explicit Production revision while a newer draft exists',async()=>{
 fixture.rows=[{id:1,catalog_id:'catalog',active_version_id:'v1',legacy_version_id:'history'}];
 fixture.versions=[{id:'v2',exercise_id:1,revision:2,editorial_status:'draft',elements:[{type:'question'}]},
 {id:'v1',exercise_id:1,revision:1,editorial_status:'published',elements:[{type:'question'}]}];
 expect(await getRandomExercise(7)).toMatchObject({versionId:'v1'});
});
it('excludes archived new starts even when strict catalogue selection is disabled',async()=>{
 fixture.rows=[{id:1,catalog_id:'catalog',active_version_id:'v1',admin_archived_at:'2026-11-13'}];
 await expect(getRandomExercise(7)).rejects.toThrow('No exercises available');
});
it('uses the pre-transition reservation after synchronization or archival',async()=>{
 fixture.rows=[{id:1,catalog_id:'catalog',active_version_id:'v2',admin_archived_at:'2026-11-13'}];
 fixture.reserved=[{exercise_id:1,exercise_version_id:'history'}];
 expect(await getRandomExercise(7)).toMatchObject({versionId:'history'});
 expect(fixture.requests.some(r=>r.pathname.endsWith('/exercise_versions'))).toBe(false);
});
