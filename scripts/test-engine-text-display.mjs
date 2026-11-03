// Differential generation check of the exact Linux archive against private 0.1.4 snapshots.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { startLocalEngine } from "./engine-pilot-local-engine.mjs";
const part = Number(process.argv[2]);
assert(Number.isInteger(part) && part >= 0 && part < 4);
const pointer = JSON.parse(
  await readFile(".local/engine-staging/catalogue-current.json", "utf8"),
);
assert.equal(pointer.projectRef, "tksvbkvfusrnxulpahky");
const previous = JSON.parse(
  await readFile(
    path.join(pointer.directory, "qualified-final.private.json"),
    "utf8",
  ),
);
assert.equal(
  previous.archiveSha256,
  "791c6472fc87ba0559d8889cf3f4482ab5466def49eec9e418ddbc2c7278f3ea",
);
const release = JSON.parse(
  await readFile("frontend/vendor/engine-release-0.1.6.json", "utf8"),
);
const work = path.resolve(
  ".local/engine-staging/text-display-" + Date.now() + "-" + part,
);
await mkdir(work);
const host = await startLocalEngine(work, {
  port: 3152 + part,
  releaseVersion: "0.1.6",
});
const mathematics = (o) =>
  o.elements
    .filter((e) => e.type === "question" || e.type === "mcq")
    .map((e) => ({
      id: e.id,
      response: e.response,
      policy: e.policy,
      expected: e.expected,
      points: e.points,
    }));
const texts = (o) =>
  o.elements
    .flatMap((e) => [
      e.text,
      ...(e.content ?? []).filter((c) => c.type === "text").map((c) => c.text),
      ...(e.options ?? [])
        .filter((c) => c.content.format === "text")
        .map((c) => c.content.text),
    ])
    .filter(Boolean);
let context;
const run = async (operation, payload) => {
  const requestId = randomUUID();
  const r = await fetch(host.environment.NOVLEARN_ENGINE_LOCAL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization:
        "Bearer " + host.environment.NOVLEARN_ENGINE_LOCAL_CAPABILITY,
    },
    body: JSON.stringify({ protocolVersion: 1, requestId, operation, payload }),
    signal: AbortSignal.timeout(12000),
  });
  assert(r.ok);
  const result = await r.json();
  assert(
    result.ok,
    JSON.stringify({
      context,
      operation,
      error: result.error,
      metrics: result.metrics,
    }),
  );
  assert.equal(result.requestId, requestId);
  return result.value;
};
const rows = [];
try {
  for (const row of previous.rows.filter((r) => r.id % 4 === part)) {
    const cases = [];
    for (const old of row.tests.filter(
      (t) => t.seed === 42 || [18, 35, 98, 110].includes(row.id),
    )) {
      context = { id: row.id, seed: old.seed };
      const r = await run("instantiateExercise", {
        definition: row.definition,
        seed: old.seed,
        instanceId: old.official.instanceId,
      });
      assert(r.ok, JSON.stringify({ id: row.id, diagnostics: r.diagnostics }));
      assert.deepEqual(
        r.value.generation,
        old.official.generation,
        "Generation changed " + row.id,
      );
      assert.deepEqual(
        JSON.parse(JSON.stringify(mathematics(r.value))),
        JSON.parse(JSON.stringify(mathematics(old.official))),
        "Grading data changed " + row.id,
      );
      const projected = await run("projectPublicInstance", {
        official: r.value,
      });
      assert(
        !/"(?:expected|policy|definition|generation|extensions)"\s*:/.test(
          JSON.stringify(projected),
        ),
      );
      const remaining = texts(r.value).filter((s) => /\+\s*-/.test(s));
      assert.equal(remaining.length, 0, "Unformatted signs " + row.id);
      cases.push({
        seed: old.seed,
        generationUnchanged: true,
        gradingDataUnchanged: true,
        publicProjection: true,
        remainingAdjacentSigns: 0,
      });
    }
    rows.push({ id: row.id, cases });
    console.log(JSON.stringify({ id: row.id, checked: cases.length }));
  }
  await writeFile(
    path.join(pointer.directory, "text-display-0.1.6-" + part + ".json"),
    JSON.stringify(
      {
        projectRef: pointer.projectRef,
        archiveSha256: release.archiveSha256,
        previousArchiveSha256: previous.archiveSha256,
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  await host.close();
}
