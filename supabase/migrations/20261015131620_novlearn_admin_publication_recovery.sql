-- Private bounded recovery read; no target write or new role membership.
BEGIN;
CREATE FUNCTION novlearn_admin_private.pending_publication_operations(p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE cursor_time timestamptz; result jsonb;
BEGIN
 IF p_after IS NOT NULL THEN
  SELECT created_at INTO cursor_time FROM novlearn_admin_private.publication_operations WHERE id=p_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery cursor unavailable' USING ERRCODE='P0002'; END IF;
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT id,created_at FROM novlearn_admin_private.publication_operations
  WHERE state IN ('executing','uncertain') AND (p_after IS NULL OR (created_at,id)>(cursor_time,p_after))
  ORDER BY created_at,id LIMIT 11
 ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY created_at,id LIMIT 10)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(novlearn_admin_private.publication_journal_item(id) ORDER BY created_at,id) FROM page),'[]'::jsonb),
  'next',CASE WHEN (SELECT count(*) FROM candidates)>10 THEN (SELECT id FROM page ORDER BY created_at DESC,id DESC LIMIT 1) ELSE NULL END)
 INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.pending_publication_operations(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.pending_publication_operations(uuid) TO novlearn_publication_journal_executor;
COMMIT;
