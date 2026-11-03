// Read-only Staging catalogue reception of the exact package, in the bounded host.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { startLocalEngine } from "./engine-pilot-local-engine.mjs";
const part = Number(process.argv[2]);
assert([0, 1].includes(part));
const pointer = JSON.parse(
  await readFile(".local/engine-staging/catalogue-current.json", "utf8"),
);
assert.equal(pointer.projectRef, "tksvbkvfusrnxulpahky");
const baseline = await readFile(
  path.join(pointer.directory, "qualified-final.private.json"),
);
const previous = JSON.parse(baseline);
const baselineSha256 = createHash("sha256").update(baseline).digest("hex");
const release = JSON.parse(
  await readFile("frontend/vendor/engine-release-0.1.8.json", "utf8"),
);
const file = path.join(pointer.directory, `engine-only-0.1.8-${part}.json`);
let rows = [];
try {
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.archiveSha256, release.archiveSha256);
  assert.equal(saved.baselineSha256, baselineSha256);
  rows = saved.rows;
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const save = (complete) =>
  writeFile(
    file,
    JSON.stringify(
      {
        projectRef: pointer.projectRef,
        archiveSha256: release.archiveSha256,
        baselineSha256,
        complete,
        rows,
      },
      null,
      2,
    ),
  );
const work = path.resolve(
  `.local/engine-staging/engine-only-${Date.now()}-${part}`,
);
await mkdir(work);
const host = await startLocalEngine(work, {
  port: 3152 + part,
  releaseVersion: "0.1.8",
});
let context;
const run = async (operation, payload) => {
  const requestId = randomUUID();
  const response = await fetch(host.environment.NOVLEARN_ENGINE_LOCAL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization:
        "Bearer " + host.environment.NOVLEARN_ENGINE_LOCAL_CAPABILITY,
    },
    body: JSON.stringify({ protocolVersion: 1, requestId, operation, payload }),
    signal: AbortSignal.timeout(12000),
  });
  assert(response.ok);
  const result = await response.json();
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
const maths = (o) =>
  JSON.parse(
    JSON.stringify(
      o.elements
        .filter((e) => e.type === "question" || e.type === "mcq")
        .map((e) => ({
          id: e.id,
          response: e.response,
          policy: e.policy,
          expected: e.expected,
          points: e.points,
        })),
    ),
  );
try {
  for (const row of previous.rows.filter(
    (r) => r.id % 2 === part && !rows.some((done) => done.id === r.id),
  )) {
    const graphs = row.definition.elements.some(
      (e) => e.type === "function-graph",
    );
    const cases = [];
    for (const old of row.tests.filter((t) => graphs || t.seed === 42)) {
      context = { id: row.id, seed: old.seed };
      const generated = await run("instantiateExercise", {
        definition: row.definition,
        seed: old.seed,
        instanceId: old.official.instanceId,
      });
      assert(generated.ok, JSON.stringify(context));
      assert.deepEqual(generated.value.generation, old.official.generation);
      assert.deepEqual(maths(generated.value), maths(old.official));
      const projected = await run("projectPublicInstance", {
        official: generated.value,
        sampleGraphs: true,
      });
      assert(
        !/"(?:expected|policy|definition|generation|extensions|mathFields|syntax)"\s*:/.test(
          JSON.stringify(projected),
        ),
      );
      let points = 0;
      for (const g of projected.elements.filter(
        (e) => e.type === "function-graph",
      )) {
        assert.equal(g.plot.version, "cortex-samples-v1");
        assert.equal(g.plot.values.length, g.functions.length);
        for (const values of g.plot.values) {
          assert.equal(values.length, 513);
          assert(values.every((v) => v === null || Number.isFinite(v)));
          points += values.filter((v) => v !== null).length;
        }
      }
      cases.push({
        seed: old.seed,
        generationUnchanged: true,
        gradingDataUnchanged: true,
        publicProjection: true,
        graphPoints: points,
      });
    }
    rows.push({ id: row.id, cases });
    await save(false);
    console.log(JSON.stringify({ id: row.id, cases: cases.length }));
  }
  if (part === 0) {
    context = { probe: "exact-arithmetic" };
    const definition = {
      schemaVersion: 5,
      kind: "composed",
      id: "arithmetic-proof",
      revision: "1",
      title: "Calcul exact",
      generation: {
        schemaVersion: 5,
        definitions: [],
        constraints: [],
        maxAttempts: 1,
        maxDraws: 1,
      },
      variables: [],
      elements: [
        {
          id: "q",
          type: "question",
          text: "Calculer",
          points: 1,
          response: { format: "latex", kind: "rational" },
          expectedLatex: "4/2",
          policy: { domain: "rational", form: "value-only" },
        },
      ],
    };
    const result = await run("instantiateExercise", {
      definition,
      seed: 42,
      instanceId: "arithmetic-proof",
    });
    assert(result.ok, JSON.stringify(result.diagnostics));
    for (const [source, state] of [
      ["2", "correct"],
      ["3", "incorrect"],
      ["(", "invalid"],
    ]) {
      const grade = await run("gradeAnswer", {
        official: result.value,
        submission: {
          schemaVersion: 5,
          instanceId: "arithmetic-proof",
          questionId: "q",
          answer: { format: "latex", source },
        },
      });
      assert.equal(grade.state, state);
    }
  }
  await save(true);
} finally {
  await host.close();
}
