// Development supervisor: private loopback capability -> stdin -> bounded Linux SDK.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
const certifiedEngineIdentities = {
  '0.1.1': 'c7116f9310da49478deb43ca64e04b974efd34765b45a22294c13b5235bdf927',
  '0.1.2': '632e5b2e6c0292a08b23872a0fad93504edac7e9e997a1129cebd8799110ed6b',
  '0.1.3': 'aa07fdf2c833900957dce2e2632e05a845025f96bf2264147a4eea99b35bcab9',
  '0.1.4': '791c6472fc87ba0559d8889cf3f4482ab5466def49eec9e418ddbc2c7278f3ea',
  '0.1.6': '206444e1efea28fd163589f36d8b0ad653968d90f3dd2e3fc8f77da135a0798d',
};

export async function startLocalEngine(artifact, { port = 3151, releaseVersion = '0.1.6' } = {}) {
  assert(Object.hasOwn(certifiedEngineIdentities, releaseVersion), 'Unknown private Engine release.');
  const certifiedEngineIdentity = {version: releaseVersion, pipelineVersion:'0.1.0', engineArchiveSha256:certifiedEngineIdentities[releaseVersion]};
  assert([3151,3152,3153,3154,3155].includes(port), 'Only isolated local Engine ports are allowed.');
  const root = process.cwd();
  assert(path.resolve(artifact).startsWith(path.resolve('.local/engine-staging') + path.sep));
  const work = path.join(artifact, 'engine-' + Date.now());
  await mkdir(work);
  const container = 'novlearn-pilot-engine-' + path.basename(work).slice(7);
  const docker = path.join(
    process.env.LOCALAPPDATA,
    'Programs/DockerDesktop/resources/bin/docker.exe',
  );
  const image =
    'node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b';
  const release = JSON.parse(
    await readFile(path.join(root, `frontend/vendor/engine-release-${releaseVersion}.json`), 'utf8'),
  );
  assert.equal(release.packageVersion, certifiedEngineIdentity.version);
  assert.equal(
    release.pipelineVersion,
    certifiedEngineIdentity.pipelineVersion,
  );
  assert.equal(
    release.archiveSha256,
    certifiedEngineIdentity.engineArchiveSha256,
  );
  const archiveHash = release.archiveSha256;
  const engine = path.join(root, 'frontend/vendor', release.archive);
  assert.equal(
    createHash('sha256')
      .update(await readFile(engine))
      .digest('hex'),
    archiveHash,
  );
  const packaged = spawnSync(
    process.execPath,
    [
      path.join(
        path.dirname(process.execPath),
        'node_modules/npm/bin/npm-cli.js',
      ),
      'pack',
      './node_modules/novlearn-exercise-engine/node_modules/@cortex-js/compute-engine',
      './node_modules/@arnog/colors',
      './node_modules/complex.js',
      '--offline',
      '--ignore-scripts',
      '--cache',
      path.join(root, '.local/engine-staging/npm-cache'),
      '--pack-destination',
      work,
      '--json',
    ],
    {
      cwd: path.join(root, 'frontend'),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1048576,
    },
  );
  assert.equal(packaged.status, 0, packaged.stderr);
  const names = {
    '@cortex-js/compute-engine': 'cortex',
    '@arnog/colors': 'colors',
    'complex.js': 'complex',
  };
  const mounts = [
    [engine, '/archives/engine.tgz'],
    [path.join(root, 'scripts/engine-pilot-local-engine-setup.mjs'), '/inputs/setup.mjs'],
    [path.join(root, 'scripts/engine-pilot-local-engine-worker.mjs'), '/inputs/worker.mjs'],
    [
      path.join(root, 'frontend/__tests__/fixtures/engine-pilot-definition.json'),
      '/inputs/definition.json',
    ],
  ];
  for (const p of JSON.parse(packaged.stdout)) {
    assert(Object.hasOwn(names, p.name));
    assert.equal(p.version, { '@cortex-js/compute-engine': '0.151.0', '@arnog/colors': '0.7.3', 'complex.js': '2.4.3' }[p.name]);
    mounts.push([
      path.join(work, p.filename),
      '/archives/' + names[p.name] + '.tgz',
    ]);
  }
  const args = [
    '--host',
    'npipe:////./pipe/dockerDesktopLinuxEngine',
    'run',
    '--name',
    container,
    '--pull',
    'never',
    '--init',
    '--interactive',
    '--network',
    'none',
    '--memory',
    '384m',
    '--memory-swap',
    '384m',
    '--pids-limit',
    '64',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '65534:65534',
    '--workdir',
    '/consumer',
    '--tmpfs',
    '/consumer:rw,nosuid,nodev,noexec,size=192m,mode=1777',
  ];
  for (const [source, target] of mounts)
    args.push(
      '--mount',
      `type=bind,source=${source},target=${target},readonly`,
    );
  args.push(image, 'node', '/inputs/setup.mjs');
  const child = spawn(docker, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  let stopped = false,
    buffer = Buffer.alloc(0),
    rejectReady,
    resolveReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const fail = (error) => {
    stopped = true;
    rejectReady(error);
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  let stderrBytes = 0;
  child.stderr.on('data', (data) => {
    stderrBytes += data.length;
    // Never log definitions, expected answers or request payloads.
    if (stderrBytes > 65536) {
      fail(Error('Engine stderr limit'));
      child.stdin.end();
    }
  });
  child.stdin.on('error', () => fail(Error('Engine input closed')));
  child.once('error', () => fail(Error('Engine process unavailable')));
  child.once('exit', (code) => fail(Error('Engine process stopped: ' + code)));
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    try {
      for (;;) {
        const end = buffer.indexOf(10);
        if (end < 0) break;
        if (end > 2099200) throw Error('Engine output limit');
        const frame = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        buffer = buffer.subarray(end + 1);
        if (frame.ready) resolveReady(frame);
        else if (pending.has(frame.requestId)) {
          const item = pending.get(frame.requestId);
          pending.delete(frame.requestId);
          item.resolve(frame);
        }
      }
      if (buffer.length > 2099200) throw Error('Engine output limit');
    } catch {
      fail(Error('Engine channel protocol'));
      child.stdin.end();
    }
  });
  const bootTimer = setTimeout(() => {
    fail(Error('Engine startup timeout'));
    child.stdin.end();
  }, 120000);
  let server;
  const close = async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const id of pending.keys())
      child.stdin.write(JSON.stringify({ cancel: id }) + '\n');
    child.stdin.end();
    if (child.exitCode === null && !stopped)
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    // Stop only this exact new runtime container if normal EOF did not finish it.
    if (child.exitCode === null)
      spawnSync(
        docker,
        [
          '--host',
          'npipe:////./pipe/dockerDesktopLinuxEngine',
          'stop',
          '--timeout',
          '5',
          container,
        ],
        { timeout: 15000, windowsHide: true, stdio: 'ignore' },
      );
  };
  try {
    const proof = await ready;
    clearTimeout(bootTimer);
    assert.deepEqual(proof.cgroup, {
      'memory.max': '402653184',
      'memory.swap.max': '0',
      'pids.max': '64',
    });
    assert.equal(proof.validDefinition, true);
    assert.equal(proof.invalidDefinitionRejected, true);
    assert.equal(proof.abortedRequestRejected, true);
    const capability = randomBytes(32).toString('hex');
    const run = (body, signal) =>
      new Promise((resolve, reject) => {
        if (stopped || pending.size >= 5 || pending.has(body.requestId))
          return reject(Error('Engine unavailable or busy'));
        const cancel = () => {
          if (!stopped)
            child.stdin.write(
              JSON.stringify({ cancel: body.requestId }) + '\n',
            );
        };
        const timer = setTimeout(() => {
          cancel();
          pending.delete(body.requestId);
          signal.removeEventListener('abort', cancel);
          reject(Error('Engine transport deadline'));
        }, 10000);
        const settle = (callback) => (value) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
          callback(value);
        };
        pending.set(body.requestId, {
          resolve: settle(resolve),
          reject: settle(reject),
        });
        child.stdin.write(JSON.stringify(body) + '\n');
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    server = createServer(async (req, res) => {
      const send = (status, body) => {
        if (!res.destroyed) {
          res.writeHead(status, {
            'content-type': 'application/json',
            'cache-control': 'private, no-store',
          });
          res.end(JSON.stringify(body));
        }
      };
      const supplied = req.headers.authorization ?? '';
      const expected = 'Bearer ' + capability;
      if (
        req.headers.host !== '127.0.0.1:' + port ||
        req.headers.origin ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      ) {
        send(403, { error: 'Private Engine channel' });
        req.resume();
        return;
      }
      if (
        req.method !== 'POST' ||
        req.url !== '/run' ||
        req.headers['content-type'] !== 'application/json'
      ) {
        send(400, { error: 'Invalid private request' });
        req.resume();
        return;
      }
      if (Number(req.headers['content-length'] ?? 0) > 1048576) {
        send(413, { error: 'Engine input limit' });
        req.resume();
        return;
      }
      let bytes = 0;
      const chunks = [];
      const controller = new AbortController();
      req.once('aborted', () => controller.abort());
      res.once('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 1048576) {
            send(413, { error: 'Engine input limit' });
            req.resume();
            return;
          }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (
          !body ||
          typeof body !== 'object' ||
          !/^[a-f0-9-]{36}$/.test(body.requestId ?? '') ||
          Object.keys(body).sort().join(',') !==
            'operation,payload,protocolVersion,requestId' ||
          body.protocolVersion !== 1 ||
          ![
            'validateDefinition',
            'validateSubmission',
            'parseMathInput',
            'generateVariables',
            'instantiateExercise',
            'projectPublicInstance',
            'gradeAnswer',
          ].includes(body.operation) ||
          !body.payload ||
          typeof body.payload !== 'object' ||
          Array.isArray(body.payload)
        ) {
          send(400, { error: 'Invalid private protocol' });
          return;
        }
        send(200, await run(body, controller.signal));
      } catch {
        send(503, { error: 'Engine interrupted or unavailable' });
      }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const sources = {};
    for (const name of [
      'scripts/engine-pilot-local-engine.mjs',
      'scripts/engine-pilot-local-engine-worker.mjs',
      'scripts/engine-pilot-local-engine-setup.mjs',
      'frontend/app/lib/engine/runtime.ts',
      'frontend/app/lib/engine/config.ts',
    ])
      sources[name] = createHash('sha256')
        .update(await readFile(path.join(root, name)))
        .digest('hex');
    await writeFile(
      path.join(work, 'proof.json'),
      JSON.stringify(
        {
          ...proof,
          image,
          archiveHash,
          container,
          network: 'none',
          readOnly: true,
          user: '65534:65534',
          maxConcurrent: 1,
          maxQueued: 4,
          sources,
        },
        null,
        2,
      ) + '\n',
    );
    return {
      container,
      artifact: work,
      environment: {
        NOVLEARN_ENGINE_LOCAL_URL: 'http://127.0.0.1:' + port + '/run',
        NOVLEARN_ENGINE_LOCAL_CAPABILITY: capability,
        NOVLEARN_ENGINE_ARCHIVE_SHA256: archiveHash,
        NOVLEARN_ENGINE_PILOTS_ENABLED: 'true',
      },
      close,
    };
  } catch (error) {
    clearTimeout(bootTimer);
    await close();
    throw error;
  }
}
