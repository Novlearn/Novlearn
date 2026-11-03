import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
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
