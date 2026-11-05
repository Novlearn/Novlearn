# NovLearn Admin — reconciliation and local SQL validation

Date: 13 October 2026. Scope: local PostgreSQL/Supabase replay, read-only
Staging inspection, additive SQL for NovLearn Admin. No SQL was written to
Staging or Production; neither project was linked for a push.

## Result

- `npx.cmd supabase db reset --local` completed successfully after Docker
  access was granted. It replayed migrations `001`–`044`,
  `20260525203757`, and the three `2026101317472x` Admin migrations. The CLI
  warning that `supabase/seed.sql` is absent did not stop the reset.
- `scripts/test-novlearn-admin-local.mjs` passed 30 assertions on the real
  local Supabase PostgreSQL instance. Its transaction rolls back its fixture
  rows.
- `scripts/test-novlearn-admin-security-local.mjs` passed 26 additional
  permission/RLS assertions on the real local PostgreSQL instance, including
  expected SQLSTATEs, profile self-escalation, anonymous access, server-owned
  attempt versions, and rollback of fixture accounts.
- `scripts/test-novlearn-admin-embedded.mjs` passed 57 embedded SQL assertions
  using PGlite and bundled pgcrypto. This is supplementary evidence; the local
  Supabase run is the PostgreSQL/Auth/RLS check.
- `node --test scripts/local-database-url.test.mjs` passed 9 URL-guard tests.
  `git diff --check` passed.
- The first integration run exposed missing RLS on `exercise_versions`; that
  was corrected and the complete reset and tests were rerun successfully.
- `supabase db advisors --local --type security --level info` reported the
  three private replay/instance tables as RLS-enabled with no policies. That
  is intentional deny-by-default behavior, reinforced by revoked client ACLs.
  The remaining mutable-search-path warnings name pre-existing historical
  functions; no new Admin function was reported with a mutable search path.

The untracked file `20261013174723_novlearn_admin_profile_role_hardening.sql`
was present in the working tree during the final replay and was included in
the test runs. It hardens profile role assignment, anonymous access and
server-owned attempt versioning. Its origin should be confirmed during review.

## What the SQL adds

`20261013174721_novlearn_admin_exercise_versioning.sql` adds nullable
`exercises.catalog_id` and `active_version_id`, immutable published
`exercise_versions`, database-computed SHA-256 fingerprints and additive
version references on attempts. No legacy exercise is assigned a catalog ID
or version, and all historical attempt references remain NULL.

`20261013174722_novlearn_admin_private_replay_and_publishing.sql` puts attempt
instance seeds/data, replay artifacts and each duel round in separate tables
with RLS and no `anon`/`authenticated` table access. It adds a duel-round
reference to duel attempts and an Admin-only publication function that changes
only the active version pointer. Existing exercise read policies are left
unchanged. Published versions reject update/delete, including through
`service_role`; authenticated users can read and edit versions only when
`profiles.role = 'admin'`. New attempts can link only published versions, and
private attempt instances must match both the published version and its
generation version.

The SQL test verified the actual `extensions.digest(..., 'sha256')` output
against Node crypto over PostgreSQL's stored `jsonb::text`; approval
fingerprint creation; approval invalidation after content edits; publication
immutability; a published-only active pointer; legacy attempts without
invented versions; rejection of draft-version attempt links; version/exercise
and duel/round relations; Admin/student/anon/service-role behavior; profile
role self-escalation protection; and private instance/replay visibility.

## Reconciliation evidence

Read-only inspection of Staging returned 70 migration ledger entries, with
latest version `20260910122045`. The local clean replay now has 48 migration
files. The ledger is therefore not a text-equivalent history and is not ready
for a direct `db push`.

The following local files have candidate content/effect matches in the remote
ledger. They are documented as mappings, not as permission to rename files or
rewrite history:

| Local file | Staging version | Finding |
|---|---|---|
| `037_restore_feedbacks_fk` | `20260515095611` | SQL effects match |
| `038_feedbacks_allow_anonymous` | `20260515100450` | SQL effects match |
| `039_feedbacks_auto_nullify_user_id` | `20260515100934` | SQL effects match |
| `043_fix_exercise_attempts_fk` | `20260520131524` | SQL effects match |
| `044_fix_handle_new_user_birth_date` | `20260910122045` | SQL effects match |

No remote version was identified for `035_tuteur_role`,
`036_feedbacks_guest_support`, `040_success_rate_leaderboard`,
`041_weekly_success_rate_and_user_stats`, or `042_is_abandoned`. Their effects
are not claimed as deployed from these local scripts. Keep the original Git
files and the Staging ledger intact; do not issue `migration repair` as an
automatic step.

The selected legacy RLS policies for `exercises`, `exercise_attempts`,
`duels` and `duel_attempts` matched between the local replay and Staging by
name and predicate. `extensions.pgcrypto` is in schema `extensions` in both.

Schema differences observed in the same comparison:

| Table | Reconstructed local | Staging | Assessment |
|---|---|---|---|
| `exercises` | `title` and `created_at` nullable; extra `competence_id text` | `title`, `chapter`, `created_at` not null; no `competence_id` | Historical schema drift; Admin DDL only adds nullable columns and does not rewrite these fields. |
| `exercise_attempts` | `attempted_at` nullable, `score`, `is_guest`, `is_abandoned`; no `created_at` | `created_at` not null, `score`, `is_guest`, `is_abandoned`; no `attempted_at` | Historical schema drift; Admin DDL references only existing `exercise_id` and adds nullable version linkage. |
| `profiles` | `role` and `has_seen_tutorial` not null | those columns nullable | Historical nullability drift; Admin authorization checks an explicit `role = 'admin'`. |

The shared columns and foreign key types required by the new migrations are
present in Staging (`exercises.id`, attempt `exercise_id`, `duels.id`, and
duel-attempt `duel_id` are bigint). `duel_attempts.element_id` is bigint in
both. No content or user rows were read for this comparison.

## Canonical history and baseline strategy

For an existing Staging/Production database, its 70-row migration ledger and
installed schema are the deployment baseline. For a fresh local database,
the checked-in historical chain is the rebuild source. These are two
documented starting points; unproven equivalences are not fabricated.

Before enabling a common forward deployment workflow, create and review a
schema-only snapshot from Staging, compare it with the installed catalog, and
preserve it as a dated baseline artifact. Validate the baseline and these
three Admin migrations on an isolated database restored from that snapshot.
Then propose one reviewed migration-history normalization plan for the
existing projects and a matching clean-bootstrap path. The Supabase CLI
compares timestamps in the local folder with its remote ledger, so the
current historical folder must not be pushed directly. Any ledger-only
normalization is a separately reviewed operation; no repair command was run
or encoded into automation here.

This strategy accepts that old SQL equivalence cannot always be proven. It
uses the current installed Staging schema as an explicit baseline, while
preserving the original migration files and recording only evidence-backed
mappings. The baseline artifact itself remains to be exported and validated
from an authenticated staging worktree.

## Staging preparation commands (not executed)

Run these only after a reviewed baseline and a separate approval to deploy.
Keep the backup outside Git and protect its credentials/data:

```powershell
# 1. Authenticate/link the dedicated Staging worktree; verify the project ref.
npx.cmd supabase login
npx.cmd supabase link --project-ref tksvbkvfusrnxulpahky
npx.cmd supabase migration list

# 2. Save a full logical backup with PostgreSQL client tools.
$secureUrl = Read-Host 'Staging database URL' -AsSecureString
$env:STAGING_DB_URL = [System.Net.NetworkCredential]::new('', $secureUrl).Password
New-Item -ItemType Directory -Force .\backups | Out-Null
pg_dump --format=custom --no-owner --no-privileges `
  --file .\backups\novlearn-staging-before-admin.dump $env:STAGING_DB_URL

# 3. Export a schema-only reference and inspect the proposed migration plan.
npx.cmd supabase db dump --linked --file .\backups\novlearn-staging-schema.sql
npx.cmd supabase db push --dry-run --linked

# STOP if migration list or dry-run reports any divergence. Do not use
# --include-all and do not run migration repair automatically.

# 4. After a separately approved apply only:
npx.cmd supabase db push --linked

# 5. Verify columns, constraints, RLS, grants, triggers, pgcrypto fingerprints,
# legacy NULLs, and Admin publication behavior against the approved checklist.
npx.cmd supabase migration list

# Read-only structural checks after an approved apply:
npx.cmd supabase db query --linked -o table "select extname, n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where extname='pgcrypto'"
npx.cmd supabase db query --linked -o table "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('exercise_versions','exercise_attempt_instances','exercise_attempt_replay_artifacts','duel_exercise_instances') order by c.relname"
npx.cmd supabase db query --linked -o table "select has_table_privilege('anon','public.exercise_versions','SELECT') as anon_versions, has_table_privilege('authenticated','public.exercise_versions','SELECT') as auth_versions, has_table_privilege('anon','public.exercise_attempt_instances','SELECT') as anon_instances, has_table_privilege('authenticated','public.exercise_attempt_replay_artifacts','SELECT') as auth_replay"
npx.cmd supabase db query --linked -o table "select count(*) filter (where exercise_version_id is null) as attempts_without_proven_version, count(*) filter (where exercise_version_id is not null) as versioned_attempts from public.exercise_attempts"

Remove-Item Env:STAGING_DB_URL
```

Run the SQL integration test only on local Supabase or an isolated Staging
branch; its URL guard rejects non-loopback hosts. Keep production legacy
read-path regression checks read-only until the application consumers are
migrated.

The two SQL migrations use explicit transactions. After a successful apply,
prefer a forward corrective migration; do not delete exercise, attempt or duel
history. Restore the pre-change backup only as an incident response after
evaluating writes made since the backup. The schema-only export is not a
substitute for the full logical backup.
