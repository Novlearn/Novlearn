import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
// Set NOVLEARN_TEST_NO_EXERCISE_CONTENT=1 to exercise the content-free target schema.
const contentFreeTarget = process.env.NOVLEARN_TEST_NO_EXERCISE_CONTENT === '1';
const migration = await readFile(
  resolve(root, 'supabase/migrations/20261112123000_catalogue_sync_target.sql'),
  'utf8',
);
const sourceMigration = await readFile(
  resolve(root, 'supabase/migrations/20261112102913_catalogue_sync_revisions.sql'),
  'utf8',
);
const publicationHeader = sourceMigration.match(
  /CREATE OR REPLACE FUNCTION novlearn_admin_private\.publication_header\([\s\S]*?\$\$;/,
)?.[0];
if (!publicationHeader) throw new Error('canonical publication_header missing');
const qualification = await readFile(
  resolve(root, 'supabase/tests/catalogue_sync_target_qualification.sql'),
  'utf8',
);

const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE novlearn_publication_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE novlearn_publication_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL DEFAULT 'student');
    CREATE FUNCTION public.is_novlearn_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND role='admin') $$;
    CREATE SCHEMA novlearn_admin_private;
    CREATE SCHEMA novlearn_catalog_sync;

    CREATE TABLE novlearn_admin_private.publication_runtime(
      singleton boolean PRIMARY KEY DEFAULT true,
      engine_contract text NOT NULL,
      generation_version text NOT NULL,
      canonicalization_version text NOT NULL,
      engine_archive_sha256 text NOT NULL
    );
    INSERT INTO novlearn_admin_private.publication_runtime VALUES
      (true,'schema-5;engine-0.1.0','mulberry32-rejection-v1','pg-jsonb-text-v1',repeat('e',64));
    ALTER TABLE novlearn_admin_private.publication_runtime ENABLE ROW LEVEL SECURITY;

    CREATE TABLE public.chapters(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, order_index integer NOT NULL,
      aliases text[] DEFAULT '{}', emoji text NOT NULL DEFAULT '📚', admin_epoch bigint NOT NULL DEFAULT 0,
      catalog_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), editorial_status text NOT NULL DEFAULT 'draft',
      admin_archived_at timestamptz, ready_at timestamptz, ready_by uuid,
      synced_fingerprint_sha256 text, synced_at timestamptz
    );
    CREATE TABLE public.competences(
      id text PRIMARY KEY, chapter_id uuid, name text NOT NULL, max_points integer DEFAULT 10,
      admin_epoch bigint NOT NULL DEFAULT 0, catalog_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      editorial_status text NOT NULL DEFAULT 'draft', admin_archived_at timestamptz,
      ready_at timestamptz, ready_by uuid, synced_fingerprint_sha256 text, synced_at timestamptz
    );
    CREATE TABLE public.flashcards(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chapter text NOT NULL, question text NOT NULL, answer text NOT NULL,
      created_at timestamptz DEFAULT now(), admin_epoch bigint NOT NULL DEFAULT 0,
      catalog_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), editorial_status text NOT NULL DEFAULT 'draft',
      admin_archived_at timestamptz, ready_at timestamptz, ready_by uuid,
      synced_fingerprint_sha256 text, synced_at timestamptz
    );
    CREATE POLICY "Flashcards admin write" ON public.flashcards FOR ALL TO PUBLIC
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND role='admin'));
    CREATE TABLE public.exercises(
      id bigint PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), title text NOT NULL, chapter text NOT NULL,
      difficulty text, competences text[], app_title text, "Is_Flash" boolean, "Need_Calculator" boolean,
      ${contentFreeTarget ? '' : "content jsonb NOT NULL DEFAULT '{}'::jsonb,"} catalog_id uuid UNIQUE, active_version_id uuid,
      admin_archived_at timestamptz, publication_epoch bigint NOT NULL DEFAULT 0,
      synced_fingerprint_sha256 text, synced_at timestamptz
    );
    CREATE SEQUENCE public.exercises_id_seq;
    CREATE TABLE public.exercise_versions(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exercise_id bigint NOT NULL REFERENCES public.exercises(id),
      revision integer NOT NULL, definition jsonb NOT NULL, engine_contract text NOT NULL,
      generation_version text NOT NULL, canonicalization_version text NOT NULL,
      definition_sha256 text NOT NULL, approval_fingerprint_sha256 text NOT NULL,
      approved_fingerprint_sha256 text, editorial_status text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
      approved_at timestamptz, approved_by uuid, published_at timestamptz, test_epoch bigint NOT NULL DEFAULT 0,
      publication_origin text NOT NULL DEFAULT 'local', ready_at timestamptz, ready_by uuid, ready_fingerprint_sha256 text,
      UNIQUE(exercise_id,revision), UNIQUE(exercise_id,id)
    );
    ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.competences ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.exercise_versions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.chapters ADD CONSTRAINT chapters_editorial_status_check CHECK(editorial_status IN ('draft','ready','published','archived'));
    ALTER TABLE public.competences ADD CONSTRAINT competences_editorial_status_check CHECK(editorial_status IN ('draft','ready','published','archived'));
    ALTER TABLE public.flashcards ADD CONSTRAINT flashcards_editorial_status_check CHECK(editorial_status IN ('draft','ready','published','archived'));
    ALTER TABLE public.exercise_versions ADD CONSTRAINT exercise_versions_origin_check CHECK(publication_origin IN ('local','transfer'));
    ALTER TABLE public.exercise_versions ADD CONSTRAINT exercise_versions_transfer_check CHECK(
      publication_origin<>'transfer' OR (editorial_status='published' AND approved_at IS NULL AND approved_by IS NULL
      AND approved_fingerprint_sha256 IS NULL AND created_by IS NULL AND updated_by IS NULL));

    CREATE FUNCTION novlearn_catalog_sync.manage_catalog_item() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalogue entities are archived, never deleted'; END IF;
      IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id) THEN
        RAISE EXCEPTION 'catalogue identity is immutable';
      END IF;
      IF TG_OP='UPDATE' AND ROW(NEW.name,NEW.aliases,NEW.emoji,NEW.order_index) IS DISTINCT FROM ROW(OLD.name,OLD.aliases,OLD.emoji,OLD.order_index)
        AND OLD.editorial_status IN ('ready','published') THEN NEW.editorial_status:='draft'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER chapters_manage BEFORE INSERT OR UPDATE OR DELETE ON public.chapters FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
    CREATE TRIGGER competences_manage BEFORE INSERT OR UPDATE OR DELETE ON public.competences FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
    CREATE TRIGGER flashcards_manage BEFORE INSERT OR UPDATE OR DELETE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
    CREATE FUNCTION public.manage_exercise_publication_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='INSERT' THEN RETURN NEW; END IF;
      IF ROW(NEW.title,NEW.chapter,NEW.difficulty,NEW.competences,NEW.app_title,NEW."Is_Flash",NEW."Need_Calculator",NEW.active_version_id,NEW.admin_archived_at)
        IS DISTINCT FROM ROW(OLD.title,OLD.chapter,OLD.difficulty,OLD.competences,OLD.app_title,OLD."Is_Flash",OLD."Need_Calculator",OLD.active_version_id,OLD.admin_archived_at)
        THEN NEW.publication_epoch:=OLD.publication_epoch+1; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER exercise_epoch BEFORE INSERT OR UPDATE ON public.exercises FOR EACH ROW EXECUTE FUNCTION public.manage_exercise_publication_epoch();
    CREATE FUNCTION public.require_published_active_exercise_version() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.active_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.exercise_versions WHERE exercise_id=NEW.id AND id=NEW.active_version_id AND editorial_status='published')
        THEN RAISE EXCEPTION 'active exercise version must be published'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER exercise_active_version BEFORE INSERT OR UPDATE OF active_version_id ON public.exercises
      FOR EACH ROW EXECUTE FUNCTION public.require_published_active_exercise_version();
    CREATE FUNCTION public.manage_exercise_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER exercise_version_manage BEFORE INSERT OR UPDATE OR DELETE ON public.exercise_versions FOR EACH ROW EXECUTE FUNCTION public.manage_exercise_version();
    CREATE FUNCTION public.inspect_exercise_publication(jsonb,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.apply_exercise_publication(jsonb,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
  `);
  await db.exec(publicationHeader);
  if (contentFreeTarget) {
    await db.exec(`
      GRANT CREATE ON SCHEMA public TO novlearn_publication_writer;
      ALTER FUNCTION public.inspect_exercise_publication(jsonb,text) OWNER TO novlearn_publication_writer;
      ALTER FUNCTION public.apply_exercise_publication(jsonb,text,text) OWNER TO novlearn_publication_writer;
      REVOKE CREATE ON SCHEMA public FROM novlearn_publication_writer;
      GRANT EXECUTE ON FUNCTION public.inspect_exercise_publication(jsonb,text),
        public.apply_exercise_publication(jsonb,text,text) TO novlearn_publication_executor;
    `);
  }
  try {
    await db.exec(migration);
  } catch (error) {
    const position = Number(error.position);
    const line = Number.isFinite(position)
      ? migration.slice(0, position - 1).split('\n').length
      : undefined;
    console.error(`target migration failed${line ? ` near line ${line}` : ''}: ${error.message}`);
    throw new Error('target migration qualification failed');
  }
  await db.exec('SET ROLE novlearn_publication_executor');
  try {
    const capabilities = await db.query(`
      SELECT novlearn_admin_private.catalogue_sync_target_contract() AS contract,
             novlearn_admin_private.inspect_catalogue_sync_item(
               'chapter','f1000000-0000-4000-8000-000000000001'
             )->>'stateToken' AS state_token,
             novlearn_admin_private.observe_catalogue_sync_batch(
               'f5000000-0000-4000-8000-000000000099',repeat('9',64)
             )->>'state' AS absent_state
    `);
    if (capabilities.rows[0]?.contract !== 'atomic-catalogue-target-v1' ||
        !/^[0-9a-f]{64}$/.test(capabilities.rows[0]?.state_token ?? '') ||
        capabilities.rows[0]?.absent_state !== 'not_applied') {
      throw new Error(`server role capability check failed: ${JSON.stringify(capabilities.rows[0])}`);
    }
    try {
      await db.query(`SELECT id FROM public.chapters LIMIT 1`);
      throw new Error('server role unexpectedly has direct table access');
    } catch (error) {
      if (error.code !== '42501') throw error;
    }
    try {
      await db.query(`SELECT novlearn_admin_private.apply_catalogue_sync_batch(
        'f5000000-0000-4000-8000-000000000099',repeat('9',64),'[]'::jsonb
      )`);
      throw new Error('invalid empty batch unexpectedly applied');
    } catch (error) {
      if (error.code !== '22023') throw error;
    }
  } finally {
    await db.exec('RESET ROLE');
  }
  try {
    await db.exec(qualification);
  } catch (error) {
    console.error(`target qualification failed: ${error.message}; code=${error.code}; detail=${error.detail}; context=${error.where}`);
    throw new Error('target qualification assertions failed');
  }

  // The function owner needs SELECT and INSERT on immutable versions, but no
  // UPDATE privilege. SELECT FOR UPDATE is deliberately unsupported; ordinary
  // reads plus the locked parent exercise and transaction advisory lock cover
  // the importer path.
  await db.exec('SET ROLE novlearn_catalogue_sync_writer');
  try {
    const readable = await db.query(`SELECT id FROM public.exercise_versions WHERE revision=3`);
    if (readable.rows.length !== 1) throw new Error('writer cannot read the imported immutable version');
    try {
      await db.query(`SELECT id FROM public.exercise_versions WHERE revision=3 FOR UPDATE`);
      throw new Error('writer unexpectedly has SELECT FOR UPDATE on immutable versions');
    } catch (error) {
      if (error.code !== '42501') throw error;
    }
  } finally {
    await db.exec('RESET ROLE');
  }
  const versionPrivileges = await db.query(`SELECT has_table_privilege(
    'novlearn_catalogue_sync_writer','public.exercise_versions','UPDATE') AS can_update`);
  if (versionPrivileges.rows[0]?.can_update !== false) {
    throw new Error('catalogue writer retained UPDATE privilege on immutable versions');
  }
  if (!contentFreeTarget) {
    const exerciseId = 'f4000000-0000-4000-8000-000000000001';
    await db.query(`UPDATE public.exercises SET content='{"legacy":"preserved"}'::jsonb WHERE catalog_id=$1`, [exerciseId]);
    await db.exec('SET ROLE novlearn_catalogue_sync_writer');
    try {
      await db.query(`UPDATE public.exercises SET synced_fingerprint_sha256=synced_fingerprint_sha256 WHERE catalog_id=$1`, [exerciseId]);
      try {
        await db.query(`UPDATE public.exercises SET content='{"legacy":"changed"}'::jsonb WHERE catalog_id=$1`, [exerciseId]);
        throw new Error('catalogue writer unexpectedly changed legacy exercise content');
      } catch (error) {
        if (error.code !== '42501') throw error;
      }
    } finally {
      await db.exec('RESET ROLE');
    }
    const preservedContent = await db.query(`SELECT content FROM public.exercises WHERE catalog_id=$1`, [exerciseId]);
    if (preservedContent.rows[0]?.content?.legacy !== 'preserved') {
      throw new Error('catalogue writer did not preserve legacy exercise content');
    }
  }

  // Submit two differently identified batches for the same inspected exercise
  // concurrently through the actual executor role. PGlite runs one engine
  // connection, so it checks overlapping RPC submissions and stale-plan
  // handling; the SQL advisory locks serialize independent PostgreSQL sessions.
  const activeVersion = await db.query(`SELECT v.definition FROM public.exercises e
    JOIN public.exercise_versions v ON v.id=e.active_version_id WHERE e.catalog_id=$1`,
    ['f4000000-0000-4000-8000-000000000001']);
  const sourceDefinition = structuredClone(activeVersion.rows[0].definition);
  sourceDefinition.catalogue.chapter = 'source-chapter-a';
  sourceDefinition.catalogue.skills = ['source-skill-b'];
  const concurrentPayload = {
    kind: 'exercise', catalogId: 'f4000000-0000-4000-8000-000000000001', fingerprint: 'c'.repeat(64),
    action: 'upsert', versionId: 'f6000000-0000-4000-8000-000000000003', revision: '3',
    dependencies: [
      { kind: 'chapter', catalogId: 'f1000000-0000-4000-8000-000000000001', sourceRef: 'source-chapter-a' },
      { kind: 'competence', catalogId: 'f2000000-0000-4000-8000-000000000001', sourceId: 'source-skill-b' },
    ],
    data: {
      catalogId: 'f4000000-0000-4000-8000-000000000001', revision: 3, definition: sourceDefinition,
      header: { title: 'ignored', chapter: 'ignored', difficulty: 'easy', competences: [],
        appTitle: 'ignored', isFlash: false, needCalculator: false },
    },
  };
  const concurrentInspection = await db.query(
    `SELECT novlearn_admin_private.inspect_catalogue_sync_item('exercise',$1::uuid) AS inspection`,
    [concurrentPayload.catalogId],
  );
  const concurrentItems = [{ payload: concurrentPayload, inspection: concurrentInspection.rows[0].inspection }];
  const concurrentBatches = [
    'f5000000-0000-4000-8000-000000000010',
    'f5000000-0000-4000-8000-000000000011',
  ];
  await db.exec('SET ROLE novlearn_publication_executor');
  try {
    const submit = (batch) => db.query(
      `SELECT novlearn_admin_private.apply_catalogue_sync_batch($1::uuid,$2::text,$3::jsonb) AS receipt`,
      [batch, 'd'.repeat(64), JSON.stringify(concurrentItems)],
    );
    const outcomes = await Promise.allSettled(concurrentBatches.map(submit));
    const committed = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    if (committed.length !== 1 || rejected.length !== 1 || rejected[0].reason.code !== '40001' ||
        committed[0].value.rows[0]?.receipt?.items?.[0]?.result !== 'unchanged') {
      throw new Error(`concurrent same-identity submissions were not serialized safely: ${JSON.stringify(
        outcomes.map(outcome => outcome.status === 'fulfilled'
          ? { status: outcome.status, receipt: outcome.value.rows[0]?.receipt }
          : { status: outcome.status, code: outcome.reason.code }),
      )}`);
    }
    const observations = await Promise.all(concurrentBatches.map(batch => db.query(
      `SELECT novlearn_admin_private.observe_catalogue_sync_batch($1::uuid,$2::text) AS observation`,
      [batch, 'd'.repeat(64)],
    )));
    const states = observations.map(result => result.rows[0]?.observation?.state).sort();
    if (states.join(',') !== 'committed,not_applied') {
      throw new Error(`concurrent submissions left unexpected receipts: ${JSON.stringify(states)}`);
    }
  } finally {
    await db.exec('RESET ROLE');
  }

  const result = await db.query(`
    SELECT r.observation->>'state' AS state, r.observation->'receipt'->>'batchId' AS batch_id,
           (SELECT count(*) FROM public.chapters WHERE catalog_id::text LIKE 'f1000000-%') AS test_chapters,
           (SELECT count(*) FROM public.competences WHERE catalog_id::text LIKE 'f2000000-%') AS test_competences,
           (SELECT count(*) FROM public.flashcards WHERE catalog_id::text LIKE 'f3000000-%') AS test_flashcards,
           (SELECT count(*) FROM public.exercises WHERE catalog_id::text LIKE 'f4000000-%') AS test_exercises,
           (SELECT count(*) FROM public.exercise_versions v JOIN public.exercises e ON e.id=v.exercise_id
             WHERE e.catalog_id::text LIKE 'f4000000-%') AS test_versions
      FROM (SELECT novlearn_admin_private.observe_catalogue_sync_batch(
        'f5000000-0000-4000-8000-000000000001',repeat('a',64)
      ) AS observation) r
  `);
  if (
    result.rows[0]?.state !== 'committed' ||
    result.rows[0]?.test_chapters !== 2 ||
    result.rows[0]?.test_competences !== 1 ||
    result.rows[0]?.test_flashcards !== 1 ||
    result.rows[0]?.test_exercises !== 1 ||
    result.rows[0]?.test_versions !== 3
  ) {
    throw new Error(`target qualification assertions failed: ${JSON.stringify(result.rows[0])}`);
  }
  console.log(`PGlite target qualification passed: ${JSON.stringify(result.rows[0])}`);
} finally {
  await db.close();
}
