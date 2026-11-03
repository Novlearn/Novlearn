import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const local=resolve(root,process.platform==="win32"?"backend/.venv/Scripts/python.exe":"backend/.venv/bin/python");
const python=process.env.CORRECTION_TEST_PYTHON || (existsSync(local)?local:"python");
// Isolate configuration from the developer's real credentials and DEBUG setting.
// Explicit plugins retain async/mocking support; coverage autoload is excluded.
// Windows may block the managed Python sqlite DLL used by the coverage plugin.
const env={...process.env,APP_ENV:"test",DEBUG:"false",SUPABASE_URL:"https://test.supabase.co",
  SUPABASE_SERVICE_KEY:"test-service-key",CORS_ORIGINS:"http://localhost:3000",
  PYTHONDONTWRITEBYTECODE:"1",PYTEST_DISABLE_PLUGIN_AUTOLOAD:"1"};
const run=spawnSync(python,["-m","pytest","-p","pytest_asyncio.plugin","-p","pytest_mock",
  "-p","no:cacheprovider","-o","asyncio_default_fixture_loop_scope=function"],{
  cwd:resolve(root,"backend"),env,stdio:"inherit"});
if(run.error) console.error("Backend test interpreter unavailable; install requirements-test.txt in backend/.venv.");
process.exitCode=run.status??1;
