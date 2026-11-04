import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { AVAILABLE_EXERCISES_FILTER } from "../../lib/exerciseAvailability";

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
      // Full exercise JSON contains answers and explanations. The generic API
      // is not an exercise-delivery endpoint; only the admin editor may fetch it.
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
          isFlash: data.is_flash ?? false,
          needCalculator: data.need_calculator ?? false,
          ...data.content,
        },
      };
    } else {
      const { data, error } = await supabase
        .from("exercises")
        .select("id, title, app_title, chapter, difficulty, created_at")
        .or(AVAILABLE_EXERCISES_FILTER)
        .order("created_at", { ascending: false });

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
