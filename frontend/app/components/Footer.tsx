import { Apple, Github, Instagram, Smartphone } from "lucide-react";
import Link from "next/link";

/**
 * Footer - Pied de page de l'application
 *
 * Optimisé : Server Component (pas de 'use client')
 * - Contenu statique avec des liens
 */
export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-app-surface-sunken/80 border-t border-app-border/60 pt-12 pb-8 mt-auto">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {/* Grille Principale */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {/* Colonne 1 : Marque & Mission */}
          <div className="space-y-4">
            <h2
              className="text-2xl font-bold bg-gradient-to-r from-app-primary to-app-accent bg-clip-text text-transparent"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              NovLearn
            </h2>
            <p className="text-content-muted text-sm leading-relaxed">
              La plateforme ultime pour maîtriser les mathématiques tout en
              s'amusant. Progressez, suivez votre progression et défiez vos amis
              !
            </p>
            <div className="flex gap-4 pt-2">
              <SocialLink
                href="https://www.instagram.com/novlearn.fr/"
                icon={<Instagram size={20} />}
                label="Instagram"
              />
              <SocialLink
                href="https://github.com/AlexAnsart/Novlearn"
                icon={<Github size={20} />}
                label="Github"
              />
            </div>
          </div>

          {/* Colonne 2 : Liens Utiles */}
          <div>
            <h3 className="text-content-strong font-semibold mb-4">Explorer</h3>
            <ul className="space-y-2 text-sm">
              <FooterLink href="/entrainement">Tous les exercices</FooterLink>
              <FooterLink href="/classement">Classement</FooterLink>
              <FooterLink href="/compte">Mon Profil</FooterLink>
            </ul>
          </div>

          {/* Colonne 3 : Légal & Support */}
          <div>
            <h3 className="text-content-strong font-semibold mb-4">Support</h3>
            <ul className="space-y-2 text-sm">
              <FooterLink href="/cgu">Conditions d'utilisation</FooterLink>
              <FooterLink href="/politique-confidentialite">Politique de confidentialité</FooterLink>
              <FooterLink href="/support/besoin-aide">Besoin d'aide</FooterLink>
              <FooterLink href="/support/forum">Forum / FAQ</FooterLink>
              <FooterLink href="mailto:support@novlearn.fr">Nous contacter</FooterLink>
            </ul>
          </div>

          {/* Colonne 4 : Mobile & Apps */}
          <div>
            <h3 className="text-content-strong font-semibold mb-4">Jouez partout</h3>
            <p className="text-content-muted text-sm mb-4">
              Bientôt disponible sur mobile et tablette.
            </p>
            <div className="flex flex-col gap-3">
              <StoreButton
                icon={<Apple size={24} />}
                title="App Store"
                subtitle="Bientôt sur"
              />
              <StoreButton
                icon={<Smartphone size={24} />}
                title="Google Play"
                subtitle="Bientôt sur"
              />
            </div>
          </div>
        </div>

        {/* Barre de Copyright */}
        <div className="pt-8 border-t border-app-border/60 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-content-subtle">
          <p>&copy; {currentYear} NovLearn. Tous droits réservés.</p>
          <div className="flex gap-6">
            <Link
              href="/politique-confidentialite"
              className="hover:text-content-main transition-colors"
            >
              Confidentialité
            </Link>
            <Link
              href="/cgu"
              className="hover:text-content-main transition-colors"
            >
              CGU
            </Link>
            <Link
              href="/sitemap"
              className="hover:text-content-main transition-colors"
            >
              Plan du site
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// --- Petits composants utilitaires pour le style ---

function FooterLink({
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
        className="text-content-muted hover:text-app-accent transition-colors"
      >
        {children}
      </Link>
    </li>
  );
}

function SocialLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-10 h-10 rounded-full bg-app-icon-bg/70 flex items-center justify-center text-content-muted hover:bg-app-primary hover:text-white transition-all duration-300"
    >
      {icon}
    </a>
  );
}

function StoreButton({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button className="flex items-center gap-3 bg-app-icon-bg/70 hover:bg-app-icon-bg-hover/80 border border-app-border text-content-strong px-4 py-2 rounded-xl transition-all w-full md:w-auto text-left group">
      <div className="text-content-muted group-hover:text-app-accent transition-colors">
        {icon}
      </div>
      <div>
        <div className="text-[10px] uppercase text-content-subtle font-bold tracking-wider">
          {subtitle}
        </div>
        <div className="text-sm font-bold font-sans">{title}</div>
      </div>
    </button>
  );
}
