import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function verifyEngineStaging() {
  const root = path.resolve(fileURLToPath(new URL('../frontend/', import.meta.url)));
  const manifest = JSON.parse(await readFile(path.join(root, 'vendor/engine-release-0.2.1.json'), 'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(manifest.archiveSha256, '6d1d52f38297d6f91be0eaa4aea57eb63f61973eae4cc83d86fd0aa6651dd85a');
  const archive = await readFile(path.join(root, 'vendor', manifest.archive));
  assert.equal(hash(archive), manifest.archiveSha256);
  assert.equal('sha512-' + createHash('sha512').update(archive).digest('base64'), manifest.archiveIntegrity);
  const installed = path.join(root, 'node_modules/novlearn-exercise-engine');
  const found = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else found.push(relative);
    }
  }
  await walk(installed);
  assert.deepEqual(found.sort(), Object.keys(manifest.files).sort());
  for (const [filename, digest] of Object.entries(manifest.files)) assert.equal(hash(await readFile(path.join(installed, filename))), digest, filename);
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.2.1'); assert.deepEqual(pkg.exports, manifest.exports);
  assert.deepEqual(pkg.dependencies, manifest.dependencies);
  for (const [entry, target] of Object.entries(pkg.exports)) {
    const api = await import(pathToFileURL(path.join(installed, target.import)));
    assert.deepEqual(Object.keys(api).sort(), manifest.publicExports[entry]);
  }
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const specification = 'file:vendor/' + manifest.archive;
  assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).dependencies['novlearn-exercise-engine'], specification);
  assert.equal(lock.packages[''].dependencies['novlearn-exercise-engine'], specification);
  assert.equal(lock.packages['node_modules/novlearn-exercise-engine'].resolved, specification);
  assert.equal(lock.packages['node_modules/novlearn-exercise-engine'].version, manifest.packageVersion);
  assert.equal(lock.packages['node_modules/novlearn-exercise-engine'].integrity, manifest.archiveIntegrity);
  const require = createRequire(path.join(installed, 'package.json'));
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    let directory = path.dirname(require.resolve(name));
    for (;;) {
      try {
        const dependency = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        if (dependency.name === name) { assert.equal(dependency.version, version, name); break; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = path.dirname(directory); assert.notEqual(parent, directory); directory = parent;
    }
  }
  return { archive: manifest.archiveSha256, installedFiles: found.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proof = await verifyEngineStaging();
  console.log(`PASS: exact Engine 0.2.1, ${proof.installedFiles} installed files, exports, lock and dependency versions.`);
}
