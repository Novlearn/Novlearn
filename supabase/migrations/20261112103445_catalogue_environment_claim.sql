BEGIN;
SET LOCAL lock_timeout = '5s';

-- The runtime row is initialized on Staging. Request JWT identity must take
-- precedence so this same migration history cannot identify Production as
-- Staging when it is eventually applied there.
CREATE OR REPLACE FUNCTION public.novlearn_catalog_is_staging()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NULLIF(auth.jwt()->>'iss','') IS NOT NULL
      THEN auth.jwt()->>'iss' = 'https://tksvbkvfusrnxulpahky.supabase.co/auth/v1'
    ELSE COALESCE((SELECT environment='staging' FROM novlearn_catalog_sync.runtime WHERE singleton),false)
  END
$$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_is_staging() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_is_staging() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.novlearn_catalog_reader_allows(p_catalog_id uuid,p_active_version_id uuid,p_archived_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.novlearn_catalog_is_staging() THEN true
    WHEN runtime.enforce_production_sync THEN p_catalog_id IS NOT NULL AND p_active_version_id IS NOT NULL AND p_archived_at IS NULL
    ELSE p_catalog_id IS NULL OR p_active_version_id IS NOT NULL END
  FROM novlearn_catalog_sync.runtime AS runtime WHERE singleton
$$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_reader_allows(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_reader_allows(uuid,uuid,timestamptz) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.novlearn_catalog_item_reader_allows(p_status text,p_archived_at timestamptz,p_synced_fingerprint text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.novlearn_catalog_is_staging() THEN true
    WHEN runtime.enforce_production_sync THEN p_status='published' AND p_archived_at IS NULL AND p_synced_fingerprint IS NOT NULL
    ELSE true END
  FROM novlearn_catalog_sync.runtime AS runtime WHERE singleton
$$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_item_reader_allows(text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_item_reader_allows(text,timestamptz,text) TO anon,authenticated,service_role;

COMMIT;
