import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // 1. On prépare la réponse
  // (C'est nécessaire pour pouvoir y attacher les cookies Supabase)
  let supabaseResponse = NextResponse.next({
    request,
  });

  // 2. On initialise Supabase pour rafraîchir la session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 3. On rafraîchit la session utilisateur
  // C'est cette ligne qui permet de valider le lien magique email !
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const path = url.pathname;

  // --- LOGIQUE DE PROTECTION DES ROUTES ---

  // A. Routes toujours publiques
  const isAuthRoute = path.startsWith("/auth");
  const isCallback = path.startsWith("/auth/callback");
  const isUpdatePassword = path.startsWith("/auth/update-password");
  // Pages consultables sans compte : mentions legales et support.
  // Le RGPD impose que la politique de confidentialite et les CGU soient
  // atteignables sans authentification ; ce sont des pages statiques sans
  // donnee utilisateur.
  const publicPages = [
    "/accueil",
    "/cgu",
    "/politique-confidentialite",
    "/sitemap",
    "/support",
  ];

  const isPublicRoute =
    isAuthRoute ||
    publicPages.some((p) => path === p || path.startsWith(`${p}/`)) ||
    path.startsWith("/invite/");

  // B. Si l'utilisateur est connecté (non anonyme) et essaie d'aller sur Login/Signup, on le renvoie à l'accueil
  // Les invités (anonymes) peuvent accéder aux pages auth pour se connecter ou s'inscrire
  // SAUF si c'est update-password (car on peut vouloir changer son mdp en étant connecté)
  const isAnonymous = (user as any)?.is_anonymous === true;
  if (user && !isAnonymous && isAuthRoute && !isUpdatePassword && !isCallback) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // C. Cas Spécial "Mot de passe oublié" :
  // La page /auth/update-password nécessite impérativement d'être connecté.
  if (isUpdatePassword && !user) {
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // D. Protection des routes privées :
  // Les utilisateurs non connectés (pas de session du tout) sont redirigés.
  // Les invités (user.is_anonymous) ont une session valide et passent librement.
  const protectedRoutes = [
    '/exercices',
    '/parametres',
    '/classement',
    '/progression',
    '/entrainement',
    '/duel',
    '/cours',
    '/validation',
  ];

  const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route));

  if (!user && isProtectedRoute) {
    url.pathname = '/auth/login';
    url.searchParams.set('redirectTo', path);
    return NextResponse.redirect(url);
  }

  if (!user && !isPublicRoute) {
    url.pathname = "/accueil";
    return NextResponse.redirect(url);
  }

  // Si tout est bon, on laisse passer avec les cookies mis à jour
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/ (API routes handle their own auth/CORS)
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|workbox-.*\\.js|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
