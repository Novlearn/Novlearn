-- Distinguish a caller-supplied attestation change from the trigger's own
-- invalidation when editable catalogue content changes.
BEGIN;

CREATE OR REPLACE FUNCTION novlearn_catalog_sync.manage_catalog_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
  content_changed boolean;
  attestation_changed boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'catalogue entities are archived, never deleted';
  END IF;

  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id THEN
      RAISE EXCEPTION 'catalogue identity is immutable';
    END IF;

    content_changed := (to_jsonb(NEW)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[]);
    -- Capture the caller's attestation values before automatic invalidation.
    attestation_changed := NEW.ready_at IS DISTINCT FROM OLD.ready_at OR
      NEW.ready_by IS DISTINCT FROM OLD.ready_by;
    IF content_changed AND OLD.editorial_status IN ('ready','published') AND
       current_setting('novlearn_catalog_sync.sync_item',true) IS DISTINCT FROM NEW.catalog_id::text AND
       current_user<>'novlearn_catalogue_sync_writer' THEN
      NEW.editorial_status:='draft';NEW.ready_at:=NULL;NEW.ready_by:=NULL;
    END IF;

    IF NEW.admin_archived_at IS DISTINCT FROM OLD.admin_archived_at AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition';
    END IF;
    IF OLD.editorial_status='archived' AND NEW.admin_archived_at IS NULL AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected restore transition';
    END IF;
    IF NEW.editorial_status='archived' AND OLD.editorial_status IS DISTINCT FROM 'archived' AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition';
    END IF;
    IF attestation_changed AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'readiness attestation is protected';
    END IF;
    IF NEW.editorial_status='ready' AND OLD.editorial_status IS DISTINCT FROM 'ready' AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected readiness transition';
    END IF;
    IF NEW.editorial_status='published' AND OLD.editorial_status IS DISTINCT FROM 'published' AND
       current_setting('novlearn_catalog_sync.sync_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'publication follows confirmed synchronization';
    END IF;
  ELSIF NEW.editorial_status<>'draft' AND current_user<>'novlearn_catalogue_sync_writer' THEN
    RAISE EXCEPTION 'insert a draft before readiness';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION novlearn_catalog_sync.manage_catalog_item() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
