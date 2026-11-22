import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { PRODUCTION_REF, STAGING_REF } from "../../lib/engine/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- CONFIGURATION CORS ---
// Liste blanche des origines autorisées (sécurité renforcée)
const ALLOWED_ORIGINS = [
  "https://novlearn.fr",
  "https://www.novlearn.fr",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://novlearn-exercice-builder.vercel.app",
];

function getCorsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("Origin") || "";
  // En développement ou si l'origine est autorisée, permettre la requête
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "private, no-store",
    "Vary": "Origin",
  };
}
// Gère la requête "Preflight" du navigateur pour le CORS
export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase URL or Service Role Key is missing.");
  }
  const environment = process.env.APP_ENV ?? (process.env.NODE_ENV === "development" ? "development" : "");
  const parsedUrl = new URL(url);
  const projectRef = parsedUrl.hostname.split(".")[0];
  const localDevelopment = environment === "development" && ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);
  const expectedRef = environment === "production" ? PRODUCTION_REF : STAGING_REF;
  if (!(["development", "staging", "production"].includes(environment)) ||
      (environment === "development" && projectRef === PRODUCTION_REF) ||
      (!localDevelopment && environment !== "development" && projectRef !== expectedRef)) {
    throw new Error("Supabase URL does not match APP_ENV.");
  }
  if (key.startsWith("ey")) {
    try {
      const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      if ((!localDevelopment && claims.ref !== projectRef) || claims.role !== "service_role") throw new Error();
    } catch {
      throw new Error("Supabase service key does not match APP_ENV.");
    }
  } else if (!key.startsWith("sb_secret_")) {
    throw new Error("Supabase service key format is invalid.");
  }
  return createClient(url, key);
};

// --- GET : Authentifié ---
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("auth") === "1") {
    const { handleLearnerExercise } = await import("../../lib/engine/learner");
    return handleLearnerExercise(request, true);
  }
  const corsHeaders = getCorsHeaders(request);
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    // This route uses the service role, so never treat possession of the URL
    // as authorization. Validate the caller's Supabase access token first.
    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: corsHeaders },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabase.auth.getUser(match[1]);
    if (authError || !authData.user || authData.user.is_anonymous) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: corsHeaders },
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const isAdmin = profile?.role === "admin";

    let dataToReturn;

    if (id) {
      // This legacy admin endpoint returns catalogue metadata only.
      // Canonical definitions and editorial actions belong to Novlearn-Admin.
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403, headers: corsHeaders },
        );
      }
      const { data, error } = await supabase
        .from("exercises")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      dataToReturn = {
        success: true,
        data: {
          id: data.id,
          title: data.title,
          appTitle: data.app_title || data.title,
          chapter: data.chapter,
          difficulty: data.difficulty,
          competences: data.competences || [],
          isFlash: data.Is_Flash ?? false,
          needCalculator: data.Need_Calculator ?? false,
        },
      };
    } else {
      const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
      let query = supabase
        .from("exercises")
        .select("id, title, app_title, chapter, difficulty, created_at");
      if (ref === PRODUCTION_REF) {
        query = query.is("admin_archived_at", null);
        query = process.env.PRODUCTION_CATALOG_SYNC_ENFORCED === "true" ?
          query.not("active_version_id", "is", null) :
          query.or("catalog_id.is.null,active_version_id.not.is.null,legacy_version_id.not.is.null");
      } else if (ref !== STAGING_REF && ref !== PRODUCTION_REF &&
          (process.env.APP_ENV ?? (process.env.NODE_ENV === "development" ? "development" : "")) !== "development") {
        throw new Error("Supabase environment is not recognized");
      }
      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;

      dataToReturn = {
        success: true,
        exercises:
          data?.map((ex: any) => ({
            id: ex.id.toString(),
            name: ex.title,
            title: ex.title,
            chapter: ex.chapter,
            difficulty: ex.difficulty,
            fileName: `db-${ex.id}`,
            createdAt: ex.created_at,
          })) || [],
        count: data?.length || 0,
      };
    }

    return NextResponse.json(dataToReturn, {
      headers: { ...corsHeaders, "Cache-Control": "private, no-store" },
    });
  } catch (error: any) {
    console.error("Erreur API GET:", error);
    return NextResponse.json(
      { success: false, error: "Exercise request failed" },
      { status: 500, headers: corsHeaders },
    );
  }
}
// Delivery/correction on the existing endpoint. Editorial writes belong to Admin.
export async function PATCH(request: Request) {
  const { handleLearnerExercise } = await import("../../lib/engine/learner");
  return handleLearnerExercise(request);
}
