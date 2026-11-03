import { HelpCircle, Home, User } from "lucide-react";
import Link from "next/link";

/**
 * Page Sitemap - Server Component
 * Contenu statique avec des liens, pas besoin d'interactivité.
 */
export default function SitemapPage() {
  return (
    <div className="flex-1 px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <h1
          className="text-4xl font-bold text-white mb-8 text-center"
          style={{ fontFamily: "'Fredoka', sans-serif" }}
        >
          Plan du site
        </h1>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Colonne 1 : Principal */}
          <SitemapSection
            icon={<Home className="text-blue-400" />}
            title="Navigation"
          >
            <SitemapLink href="/">Accueil</SitemapLink>
            <SitemapLink href="/exercices">Exercice</SitemapLink>
            <SitemapLink href="/entrainement">Entraînement Libre</SitemapLink>
            <SitemapLink href="/classement">Classement Général</SitemapLink>
          </SitemapSection>

          {/* Colonne 2 : Compte */}
          <SitemapSection
            icon={<User className="text-indigo-400" />}
            title="Espace Membre"
          >
            <SitemapLink href="/auth/login">Connexion</SitemapLink>
            <SitemapLink href="/auth/signup">Inscription</SitemapLink>
            <SitemapLink href="/compte">Mon Profil</SitemapLink>
            <SitemapLink href="/progression">Ma Progression</SitemapLink>
            <SitemapLink href="/parametres">Paramètres</SitemapLink>
          </SitemapSection>

          {/* Colonne 3 : Support */}
          <SitemapSection
            icon={<HelpCircle className="text-emerald-400" />}
            title="Aide & Infos"
          >
            <SitemapLink href="/cgu">Conditions d'Utilisation</SitemapLink>
            <SitemapLink href="/politique-confidentialite">
              Politique de Confidentialité
            </SitemapLink>
            <SitemapLink href="mailto:contact@novlearn.fr">
              Contact Support
            </SitemapLink>
          </SitemapSection>
        </div>
      </div>
    </div>
  );
}

function SitemapSection({ icon, title, children }: any) {
  return (
    <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700/50">
        {icon}
        <h2 className="text-xl font-bold text-white">{title}</h2>
      </div>
      <ul className="space-y-3">{children}</ul>
    </div>
  );
}

function SitemapLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="text-slate-400 hover:text-white hover:translate-x-1 transition-all inline-flex items-center gap-2 group"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-600 group-hover:bg-indigo-500 transition-colors"></span>
        {children}
      </Link>
    </li>
  );
}
