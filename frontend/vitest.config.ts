import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    setupFiles: ["__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["app/lib/**/*.ts", "app/utils/math/**/*.ts", "app/utils/variableGenerator.ts", "app/renderers/{Question,Equation,MCQ}Renderer.tsx", "app/components/Exercise/ExerciseLoader.tsx"],
      exclude: ["app/lib/supabase*.ts", "app/lib/colyseusClient.ts"],
    },
  },
});
