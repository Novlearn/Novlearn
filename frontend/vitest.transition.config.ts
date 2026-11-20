import {defineConfig} from 'vitest/config';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export default defineConfig({resolve:{alias:{'@supabase/supabase-js':require.resolve('@supabase/supabase-js')}},
 test:{environment:'node',include:['test-transition/**/*.test.ts'],testTimeout:30000,maxWorkers:1,minWorkers:1}});
