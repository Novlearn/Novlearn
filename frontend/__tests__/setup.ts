/**
 * Fichier de setup global pour les tests frontend (vitest).
 * Mocke les modules Next.js et Supabase qui ne sont pas disponibles
 * dans l'environnement de test Node.js.
 */
import { vi } from "vitest";
// The runtime boundary is enforced by Next.js; Vitest runs server routes in Node.
vi.mock("server-only", () => ({}));

// Mock next/navigation (non disponible hors du routeur Next.js)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Supabase (évite les connexions réseau)
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  })),
}));
