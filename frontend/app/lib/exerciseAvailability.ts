// Keep aligned with backend/exercise_availability.py and the reviewed SQL RPC.
// The database requires active canonical versions to be published. Historical
// exercises have no catalog_id. Apply even for an Admin using a student screen.
export const AVAILABLE_EXERCISES_FILTER =
  "catalog_id.is.null,active_version_id.not.is.null";
