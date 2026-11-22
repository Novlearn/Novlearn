-- Keep exercise-version triggers limited to version fields and protect the
-- archive/readiness transitions on the editorial catalogue tables.
BEGIN;

CREATE OR REPLACE FUNCTION public.manage_exercise_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE content_changed boolean := false; ready_changed boolean := false;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    content_changed := NEW.exercise_id IS DISTINCT FROM OLD.exercise_id OR NEW.revision IS DISTINCT FROM OLD.revision OR
      NEW.definition IS DISTINCT FROM OLD.definition OR NEW.engine_contract IS DISTINCT FROM OLD.engine_contract OR
      NEW.generation_version IS DISTINCT FROM OLD.generation_version OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version;
    ready_changed := NEW.ready_at IS DISTINCT FROM OLD.ready_at OR NEW.ready_by IS DISTINCT FROM OLD.ready_by OR
      NEW.ready_fingerprint_sha256 IS DISTINCT FROM OLD.ready_fingerprint_sha256;
    IF content_changed AND OLD.editorial_status='ready' THEN NEW.editorial_status:='draft'; END IF;
    IF NEW.editorial_status='ready' AND OLD.editorial_status<>'ready' AND
       current_setting('novlearn_catalog_sync.ready_version',true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'use the protected readiness transition'; END IF;
    IF NEW.editorial_status='published' AND OLD.editorial_status<>'ready' THEN
      RAISE EXCEPTION 'only ready revisions can be published'; END IF;
    IF ready_changed AND NOT content_changed AND NEW.editorial_status='ready' AND
       current_setting('novlearn_catalog_sync.ready_version',true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'readiness attestation is protected'; END IF;
  ELSIF NEW.publication_origin='transfer' THEN
    IF NEW.editorial_status<>'published' THEN RAISE EXCEPTION 'transferred revisions are published'; END IF;
  ELSIF NEW.editorial_status<>'draft' THEN
    RAISE EXCEPTION 'insert a draft before readiness';
  END IF;
  NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
  NEW.approval_fingerprint_sha256:=encode(extensions.digest(convert_to(jsonb_build_object(
    'exercise_id',NEW.exercise_id,'revision',NEW.revision,'definition',NEW.definition,
    'engine_contract',NEW.engine_contract,'generation_version',NEW.generation_version,
    'canonicalization_version',NEW.canonicalization_version)::text,'UTF8'),'sha256'),'hex');
  IF NEW.editorial_status='ready' THEN
    IF NEW.ready_at IS NULL OR NEW.ready_by IS NULL THEN RAISE EXCEPTION 'readiness metadata is required'; END IF;
    NEW.ready_fingerprint_sha256:=NEW.approval_fingerprint_sha256;
  ELSIF NEW.editorial_status='published' AND NEW.publication_origin='local' THEN
    IF NEW.ready_at IS NULL OR NEW.ready_by IS NULL OR NEW.ready_fingerprint_sha256 IS DISTINCT FROM NEW.approval_fingerprint_sha256 THEN
      RAISE EXCEPTION 'published source must retain its readiness proof'; END IF;
  ELSIF NEW.editorial_status='published' AND NEW.publication_origin='transfer' THEN
    NEW.ready_at:=NULL; NEW.ready_by:=NULL; NEW.ready_fingerprint_sha256:=NULL;
  ELSE
    NEW.ready_at:=NULL; NEW.ready_by:=NULL; NEW.ready_fingerprint_sha256:=NULL;
  END IF;
  IF NEW.editorial_status='published' THEN NEW.published_at:=coalesce(NEW.published_at,now()); END IF;
  NEW.updated_at:=now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION novlearn_catalog_sync.manage_catalog_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE content_changed boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalogue entities are archived, never deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id THEN
      RAISE EXCEPTION 'catalogue identity is immutable'; END IF;
    content_changed:=(to_jsonb(NEW)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[]);
    IF content_changed AND OLD.editorial_status IN ('ready','published') THEN NEW.editorial_status:='draft';NEW.ready_at:=NULL;NEW.ready_by:=NULL;END IF;
    IF NEW.admin_archived_at IS DISTINCT FROM OLD.admin_archived_at AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition'; END IF;
    IF OLD.editorial_status='archived' AND NEW.admin_archived_at IS NULL AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected restore transition'; END IF;
    IF NEW.editorial_status='archived' AND OLD.editorial_status IS DISTINCT FROM 'archived' AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition'; END IF;
    IF (NEW.ready_at IS DISTINCT FROM OLD.ready_at OR NEW.ready_by IS DISTINCT FROM OLD.ready_by) AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'readiness attestation is protected'; END IF;
    IF NEW.editorial_status='ready' AND OLD.editorial_status IS DISTINCT FROM 'ready' AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected readiness transition'; END IF;
    IF NEW.editorial_status='published' AND OLD.editorial_status IS DISTINCT FROM 'published' AND
       current_setting('novlearn_catalog_sync.sync_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'publication follows confirmed synchronization'; END IF;
  ELSIF NEW.editorial_status<>'draft' THEN
    RAISE EXCEPTION 'insert a draft before readiness';
  END IF;
  RETURN NEW;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
