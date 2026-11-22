-- The runtime singleton is private configuration read only by bounded
-- SECURITY DEFINER readers owned by postgres. Keep direct access closed.
ALTER TABLE novlearn_catalog_sync.runtime ENABLE ROW LEVEL SECURITY;
