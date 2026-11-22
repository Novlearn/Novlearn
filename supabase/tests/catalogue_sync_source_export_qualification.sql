-- Run with psql against an isolated NovLearn source database after applying
-- the canonical source migrations through 20261112122207. The first phase
-- asserts the old 42P01 failure; the script then applies the new correction
-- and verifies success. Requires synthetic admin and non-admin profiles.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.chapters(id,catalog_id,name,order_index,aliases,emoji)
VALUES('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001',
       'Qualification export chapter','9971','{}','🧪');
SELECT set_config('novlearn_catalog_sync.ready_item','f7000000-0000-4000-8000-000000000001',true);
UPDATE public.chapters SET editorial_status='ready',ready_at=clock_timestamp(),
  ready_by=(SELECT id FROM public.profiles WHERE role='admin' ORDER BY id LIMIT 1)
WHERE catalog_id='f7000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.profiles WHERE role='admin' ORDER BY id LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $reproduce_old_chapter_export_failure$
DECLARE fingerprint text;
BEGIN
  SELECT encode(extensions.digest(convert_to((to_jsonb(chapter_row)-
    ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex')
    INTO fingerprint FROM public.chapters chapter_row
    WHERE catalog_id='f7000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.admin_export_catalogue_sync_item('chapter','f7000000-0000-4000-8000-000000000001',fingerprint);
    RAISE EXCEPTION 'pre-fix chapter export unexpectedly succeeded';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$reproduce_old_chapter_export_failure$;
RESET ROLE;
ROLLBACK;
\ir ../migrations/20261112205334_catalogue_export_chapter_row_fix.sql

BEGIN;

INSERT INTO public.chapters(id,catalog_id,name,order_index,aliases,emoji)
VALUES('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001',
       'Qualification export chapter','9971','{}','🧪');
SELECT set_config('novlearn_catalog_sync.ready_item','f7000000-0000-4000-8000-000000000001',true);
UPDATE public.chapters SET editorial_status='ready',ready_at=clock_timestamp(),
  ready_by=(SELECT id FROM public.profiles WHERE role='admin' ORDER BY id LIMIT 1)
WHERE catalog_id='f7000000-0000-4000-8000-000000000001';
SELECT set_config('test.catalogue_admin_id',(SELECT id::text FROM public.profiles WHERE role='admin' ORDER BY id LIMIT 1),true);
SELECT set_config('test.catalogue_student_id',(SELECT id::text FROM public.profiles WHERE role<>'admin' ORDER BY id LIMIT 1),true);
SELECT set_config('request.jwt.claim.sub',current_setting('test.catalogue_admin_id'),true);
SET LOCAL ROLE authenticated;

DO $chapter_export$
DECLARE exported jsonb; fingerprint text;
BEGIN
  SELECT encode(extensions.digest(convert_to((to_jsonb(chapter_row)-
    ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex')
    INTO fingerprint FROM public.chapters chapter_row
    WHERE catalog_id='f7000000-0000-4000-8000-000000000001';
  exported:=public.admin_export_catalogue_sync_item('chapter','f7000000-0000-4000-8000-000000000001',fingerprint);
  IF exported->>'action'<>'upsert' OR exported->'data'->>'name'<>'Qualification export chapter' THEN
    RAISE EXCEPTION 'ready chapter did not export as an upsert';
  END IF;
  BEGIN
    PERFORM public.admin_export_catalogue_sync_item('chapter','f7000000-0000-4000-8000-000000000001',repeat('0',64));
    RAISE EXCEPTION 'stale chapter fingerprint was accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',current_setting('test.catalogue_student_id'),true);
  BEGIN
    PERFORM public.admin_export_catalogue_sync_item('chapter','f7000000-0000-4000-8000-000000000001',fingerprint);
    RAISE EXCEPTION 'non-admin chapter export was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',current_setting('test.catalogue_admin_id'),true);
END;
$chapter_export$;

RESET ROLE;
SELECT set_config('novlearn_catalog_sync.archive_item','f7000000-0000-4000-8000-000000000001',true);
UPDATE public.chapters SET admin_archived_at=clock_timestamp(),editorial_status='archived'
WHERE catalog_id='f7000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $chapter_archive$
DECLARE exported jsonb; fingerprint text;
BEGIN
  SELECT encode(extensions.digest(convert_to((to_jsonb(chapter_row)-
    ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex')
    INTO fingerprint FROM public.chapters chapter_row
    WHERE catalog_id='f7000000-0000-4000-8000-000000000001';
  exported:=public.admin_export_catalogue_sync_item('chapter','f7000000-0000-4000-8000-000000000001',fingerprint);
  IF exported->>'action'<>'archive' THEN RAISE EXCEPTION 'archived chapter did not export as an archive'; END IF;
END;
$chapter_archive$;

ROLLBACK;
