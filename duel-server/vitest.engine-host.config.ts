import {defineConfig} from "vitest/config";
export default defineConfig({test:{environment:"node",include:["test-host/**/*.test.ts"],testTimeout:30000,maxWorkers:1,minWorkers:1}});
