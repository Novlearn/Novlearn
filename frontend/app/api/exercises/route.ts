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

function getCorsHeaders(request?: Request): HeadersInit {
  const origin = request?.headers.get("Origin") || "";
  // En développement ou si l'origine est autorisée, permettre la requête
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-admin-secret",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Comparaison sécurisée timing-safe pour prévenir les timing attacks
function timingSafeCompare(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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

    const supabase = getSupabaseAdmin();

    let dataToReturn;

    if (id) {
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

    return NextResponse.json(dataToReturn, { headers: corsHeaders });
  } catch (error: any) {
    console.error("Erreur API GET:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders },
    );
  }
}

// Internal delivery/correction on the existing exercise endpoint. The editor's
// POST/DELETE contracts remain separate and retain their existing authorization.
export async function PATCH(request: Request) {
  const { handleLearnerExercise } = await import("../../lib/engine/learner");
  return handleLearnerExercise(request);
}

// --- POST : ADMIN ONLY ---
export async function POST(request: Request) {
  const corsHeaders = getCorsHeaders(request);
  const authHeader = request.headers.get("x-admin-secret");
  // Utilisation d'une comparaison timing-safe pour prévenir les timing attacks
  if (!timingSafeCompare(authHeader, process.env.ADMIN_API_SECRET)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .upsert(body)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders },
    );
  }
}

// --- DELETE : ADMIN ONLY ---
export async function DELETE(request: Request) {
  const corsHeaders = getCorsHeaders(request);
  const authHeader = request.headers.get("x-admin-secret");
  // Utilisation d'une comparaison timing-safe pour prévenir les timing attacks
  if (!timingSafeCompare(authHeader, process.env.ADMIN_API_SECRET)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id)
    return NextResponse.json(
      { error: "Missing ID" },
      { status: 400, headers: corsHeaders },
    );

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("exercises")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders },
    );
  }
}
