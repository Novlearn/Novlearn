import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import withSerwist from "@serwist/next";

const withSerwistConfig = withSerwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Le package.json racine (CLI supabase + scripts) produit un second
  // lockfile. Sans cette ligne, Next remonte a la racine du monorepo pour
  // inferer le workspace et emet un avertissement a chaque build.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  async redirects() {
    return [
      {
        // Ancienne URL de la politique de confidentialité.
        source: "/privacy",
        destination: "/politique-confidentialite",
        permanent: true,
      },
    ];
  },
  // Configuration pour le développement local et la production
  async rewrites() {
    if(process.env.NODE_ENV === "development" && process.env.NOVLEARN_ENGINE_ENABLED === "true") {
      return {afterFiles:[{source:"/api/:path*",destination:"http://127.0.0.1:8011/api/:path*"}]};
    }
    // En développement, proxy vers localhost
    if (process.env.NODE_ENV === "development") {
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:8010/api/:path*",
        },
      ];
    }
    // En production, les rewrites sont gérés par Apache (reverse proxy)
    return [];
  },
};

// The isolated Staging launcher uses Turbopack and no service-worker build.
// Keep the existing production/development configuration for other entry points.
export default process.env.NODE_ENV === "development" && process.env.NOVLEARN_ENGINE_ENABLED === "true"
  ? nextConfig
  : withSerwistConfig(nextConfig);
