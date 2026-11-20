-- Run only on an isolated NovLearn target after applying the canonical target
-- migration. This test intentionally leaves prefixed fixture rows and one
-- durable receipt so replay can be checked in a second SQL call.
DO $qualification$
DECLARE
  chapter_a uuid:='f1000000-0000-4000-8000-000000000001';
  chapter_b uuid:='f1000000-0000-4000-8000-000000000002';
  competence_b uuid:='f2000000-0000-4000-8000-000000000001';
  flashcard_a uuid:='f3000000-0000-4000-8000-000000000001';
  exercise_a uuid:='f4000000-0000-4000-8000-000000000001';
  never_sent uuid:='f1000000-0000-4000-8000-000000000099';
  batch uuid:='f5000000-0000-4000-8000-000000000001';
  payloads jsonb; payload jsonb; receipt jsonb; replay jsonb; observation jsonb;
  conflict_batch uuid:='f5000000-0000-4000-8000-000000000002';
  conflict_chapter uuid:='f1000000-0000-4000-8000-000000000003';
  conflict_items jsonb; stale_items jsonb; duplicate_items jsonb;
  legacy_flashcard_policy text; flashcard_item jsonb; flashcard_receipt jsonb;
BEGIN
  IF novlearn_admin_private.catalogue_sync_target_contract()<>'atomic-catalogue-target-v1' THEN
    RAISE EXCEPTION 'target capability marker is not qualified';
  END IF;

  -- Recreate the historical policy to prove the original permission failure,
  -- then replace it with the migration's SECURITY DEFINER admin check. This
  -- stays inside the qualification transaction and leaves no policy residue.
  EXECUTE 'DROP POLICY IF EXISTS "Flashcards admin write" ON public.flashcards';
  EXECUTE $policy$CREATE POLICY "Flashcards admin write" ON public.flashcards FOR ALL TO PUBLIC
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND role='admin'))$policy$;
  BEGIN
    payloads:=jsonb_build_array(
      jsonb_build_object('payload',jsonb_build_object('kind','chapter','catalogId',chapter_a,'fingerprint',repeat('1',64),'action','upsert',
        'versionId',NULL,'revision',NULL,'dependencies','[]'::jsonb,
        'data',jsonb_build_object('catalogId',chapter_a,'name','Qualification chapter A','aliases','[]'::jsonb,'emoji','🧪','orderIndex',9901)),
        'inspection',novlearn_admin_private.inspect_catalogue_sync_item('chapter',chapter_a)),
      jsonb_build_object('payload',jsonb_build_object('kind','flashcard','catalogId',flashcard_a,'fingerprint',repeat('4',64),'action','upsert',
        'versionId',NULL,'revision',NULL,'dependencies',jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',chapter_a,'sourceRef','source-chapter-a')),
        'data',jsonb_build_object('catalogId',flashcard_a,'question','Qualification question','answer','Qualification answer','chapterCatalogId',chapter_a)),
        'inspection',novlearn_admin_private.inspect_catalogue_sync_item('flashcard',flashcard_a)));
    PERFORM novlearn_admin_private.apply_catalogue_sync_batch('f5000000-0000-4000-8000-000000000000',repeat('0',64),payloads);
    RAISE EXCEPTION 'historical flashcard policy unexpectedly allowed the internal writer';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS legacy_flashcard_policy = MESSAGE_TEXT;
    IF legacy_flashcard_policy NOT ILIKE '%permission denied for table profiles%' THEN RAISE; END IF;
  END;
  EXECUTE 'DROP POLICY "Flashcards admin write" ON public.flashcards';
  EXECUTE $policy$CREATE POLICY "Flashcards admin write" ON public.flashcards FOR ALL TO authenticated
    USING ((SELECT public.is_novlearn_admin())) WITH CHECK ((SELECT public.is_novlearn_admin()))$policy$;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='flashcards'
      AND policyname='Flashcards admin write' AND roles=ARRAY['authenticated']::name[]
      AND qual ILIKE '%is_novlearn_admin%' AND qual NOT ILIKE '%profiles%') THEN
    RAISE EXCEPTION 'historical admin policy was not replaced with the bounded helper';
  END IF;

  payloads:=jsonb_build_array(
    jsonb_build_object('payload',jsonb_build_object('kind','chapter','catalogId',chapter_a,'fingerprint',repeat('1',64),'action','upsert',
      'versionId',NULL,'revision',NULL,'dependencies','[]'::jsonb,
      'data',jsonb_build_object('catalogId',chapter_a,'name','Qualification chapter A','aliases','[]'::jsonb,'emoji','🧪','orderIndex',9901)),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('chapter',chapter_a)),
    jsonb_build_object('payload',jsonb_build_object('kind','chapter','catalogId',chapter_b,'fingerprint',repeat('2',64),'action','upsert',
      'versionId',NULL,'revision',NULL,'dependencies','[]'::jsonb,
      'data',jsonb_build_object('catalogId',chapter_b,'name','Qualification chapter B','aliases','[]'::jsonb,'emoji','🧪','orderIndex',9902)),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('chapter',chapter_b)),
    jsonb_build_object('payload',jsonb_build_object('kind','competence','catalogId',competence_b,'fingerprint',repeat('3',64),'action','upsert',
      'versionId',NULL,'revision',NULL,'dependencies',jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',chapter_b,'sourceId','source-chapter-b')),
      'data',jsonb_build_object('catalogId',competence_b,'id','source-skill-b','name','Qualification skill B','chapterCatalogId',chapter_b,'maxPoints',7)),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('competence',competence_b)),
    jsonb_build_object('payload',jsonb_build_object('kind','flashcard','catalogId',flashcard_a,'fingerprint',repeat('4',64),'action','upsert',
      'versionId',NULL,'revision',NULL,'dependencies',jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',chapter_a,'sourceRef','source-chapter-a')),
      'data',jsonb_build_object('catalogId',flashcard_a,'question','Qualification question','answer','Qualification answer','chapterCatalogId',chapter_a)),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('flashcard',flashcard_a)),
    jsonb_build_object('payload',jsonb_build_object('kind','exercise','catalogId',exercise_a,'fingerprint',repeat('5',64),'action','upsert',
      'versionId','f6000000-0000-4000-8000-000000000001','revision',1,
      'dependencies',jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',chapter_a,'sourceRef','source-chapter-a'),
        jsonb_build_object('kind','competence','catalogId',competence_b,'sourceId','source-skill-b')),
      'data',jsonb_build_object('catalogId',exercise_a,'revision',1,
        'definition',jsonb_build_object('schemaVersion',5,'kind','composed','id',exercise_a,'revision','1','title','Selected revision title',
          'catalogue',jsonb_build_object('chapter','source-chapter-a','skills',jsonb_build_array('source-skill-b'),'difficulty',2,
            'appTitle','Qualification exercise','exerciseType','classic','needsCalculator',false),
          'elements',jsonb_build_array(jsonb_build_object('type','text','content','Keep mathematical content unchanged'))),
        'header',jsonb_build_object('title','Stale header must be ignored','chapter','wrong chapter','difficulty','hard',
          'competences','[]'::jsonb,'appTitle','wrong app title','isFlash',false,'needCalculator',true))),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('exercise',exercise_a)),
    jsonb_build_object('payload',jsonb_build_object('kind','chapter','catalogId',never_sent,'fingerprint',repeat('6',64),'action','archive',
      'versionId',NULL,'revision',NULL,'dependencies','[]'::jsonb,
      'data',jsonb_build_object('catalogId',never_sent,'name','Never transferred archive','aliases','[]'::jsonb,'emoji','📚','orderIndex',9903)),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('chapter',never_sent))
  );

  receipt:=novlearn_admin_private.apply_catalogue_sync_batch(batch,repeat('a',64),payloads);
  replay:=novlearn_admin_private.apply_catalogue_sync_batch(batch,repeat('a',64),payloads);
  IF replay IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'same digest did not replay the durable receipt'; END IF;
  observation:=novlearn_admin_private.observe_catalogue_sync_batch(batch,repeat('a',64));
  IF observation->>'state'<>'committed' OR observation->'receipt' IS DISTINCT FROM receipt THEN
    RAISE EXCEPTION 'committed receipt was not observable';
  END IF;
  BEGIN
    PERFORM novlearn_admin_private.observe_catalogue_sync_batch(batch,repeat('b',64));
    RAISE EXCEPTION 'batch id accepted a different digest';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=never_sent) THEN
    RAISE EXCEPTION 'archive of never-transferred content created a target row';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'items') x
    WHERE x->>'kind'='chapter' AND x->>'catalogId'=never_sent::text AND x->>'targetId'=never_sent::text AND x->>'result'='unchanged') THEN
    RAISE EXCEPTION 'absent archive did not use its stable identity receipt';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.exercises e JOIN public.exercise_versions v ON v.exercise_id=e.id AND v.id=e.active_version_id
      JOIN public.competences c ON c.id=ANY(e.competences)
    WHERE e.catalog_id=exercise_a AND e.title='Selected revision title' AND e.chapter='Qualification chapter A'
      AND e.app_title='Qualification exercise' AND c.catalog_id=competence_b
      AND v.definition->'elements'->0->>'content'='Keep mathematical content unchanged') THEN
    RAISE EXCEPTION 'exercise header/reference projection was not rebuilt from the selected revision';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.flashcards WHERE catalog_id=flashcard_a AND chapter='Qualification chapter A') THEN
    RAISE EXCEPTION 'flashcard reference was not remapped';
  END IF;

  -- Exercise update and archive under the legacy-policy replacement. These
  -- calls run through the same SECURITY DEFINER writer as the real import.
  flashcard_item:=jsonb_build_object('payload',((payloads->3)->'payload')||jsonb_build_object(
    'data',((payloads->3)->'payload'->'data')||jsonb_build_object('question','Updated qualification question')),
    'inspection',novlearn_admin_private.inspect_catalogue_sync_item('flashcard',flashcard_a));
  flashcard_receipt:=novlearn_admin_private.apply_catalogue_sync_batch('f5000000-0000-4000-8000-000000000003',repeat('d',64),jsonb_build_array(flashcard_item));
  IF NOT EXISTS(SELECT 1 FROM public.flashcards WHERE catalog_id=flashcard_a AND question='Updated qualification question') OR
     flashcard_receipt->'items'->0->>'result'<>'applied' THEN
    RAISE EXCEPTION 'flashcard update failed with the historical policy replacement active';
  END IF;
  flashcard_item:=jsonb_build_object('payload',((flashcard_item->'payload')||jsonb_build_object('action','archive')),
    'inspection',novlearn_admin_private.inspect_catalogue_sync_item('flashcard',flashcard_a));
  flashcard_receipt:=novlearn_admin_private.apply_catalogue_sync_batch('f5000000-0000-4000-8000-000000000004',repeat('e',64),jsonb_build_array(flashcard_item));
  IF NOT EXISTS(SELECT 1 FROM public.flashcards WHERE catalog_id=flashcard_a AND admin_archived_at IS NOT NULL) OR
     flashcard_receipt->'items'->0->>'result'<>'archived' THEN
    RAISE EXCEPTION 'flashcard archive failed with the historical policy replacement active';
  END IF;

  -- A later conflict must roll back an earlier chapter insert in this same lot.
  conflict_items:=jsonb_build_array(
    jsonb_build_object('payload',jsonb_build_object('kind','chapter','catalogId',conflict_chapter,'fingerprint',repeat('7',64),'action','upsert',
      'versionId',NULL,'revision',NULL,'dependencies','[]'::jsonb,
      'data',jsonb_build_object('catalogId',conflict_chapter,'name','Must roll back','aliases','[]'::jsonb,'emoji','🧪','orderIndex',9904)),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('chapter',conflict_chapter)),
    jsonb_build_object('payload',((payloads->4)->'payload')||jsonb_build_object('data',((payloads->4)->'payload'->'data')||
      jsonb_build_object('definition',((payloads->4)->'payload'->'data'->'definition')||jsonb_build_object('title','Conflicting immutable revision')),
      'dependencies',jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',conflict_chapter,'sourceRef','source-chapter-new'),
        jsonb_build_object('kind','competence','catalogId',competence_b,'sourceId','source-skill-b'))),
      'inspection',novlearn_admin_private.inspect_catalogue_sync_item('exercise',exercise_a))
  );
  BEGIN
    PERFORM novlearn_admin_private.apply_catalogue_sync_batch(conflict_batch,repeat('c',64),conflict_items);
    RAISE EXCEPTION 'immutable revision conflict was accepted';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=conflict_chapter) OR
     novlearn_admin_private.observe_catalogue_sync_batch(conflict_batch,repeat('c',64))->>'state'<>'not_applied' THEN
    RAISE EXCEPTION 'failed target lot left a row or receipt behind';
  END IF;
END;
$qualification$;
