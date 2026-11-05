"use client";

import { Lock, User } from "lucide-react";
import AvatarDisplay from "./account/AvatarDisplay";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { GuestConversionModal } from "./GuestLock/GuestConversionModal";
import { Footer } from "./Footer";
import { Logo } from "./Logo";
import { SidebarIcon } from "./SidebarIcon";
import { DuelAcceptedRedirect } from "./DuelAcceptedRedirect";
import { DuelNotifications } from "./DuelNotifications";

interface LayoutProps {
  children: ReactNode;
  isFullScreen?: boolean;
}

// Icône de sidebar verrouillée pour les invités
function LockedSidebarIcon({
  emoji,
  onUnlockClick,
  className,
}: {
  emoji: string;
  onUnlockClick: () => void;
  className?: string;
}) {
  return (
    <div className={`relative cursor-pointer ${className ?? ""}`} onClick={onUnlockClick}>
      <div className="pointer-events-none opacity-40">
        <SidebarIcon emoji={emoji} active={false} onClick={() => {}} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <Lock className="w-4 h-4 text-content-strong/60" />
      </div>
    </div>
  );
}

export function Layout({ children, isFullScreen = false }: LayoutProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, isGuest } = useAuth();

  useEffect(() => {
    const checkMobile = () => {
      if (typeof window !== "undefined") {
        setIsMobile(window.innerWidth <= 768);
      }
    };

    checkMobile();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", checkMobile);
      return () => window.removeEventListener("resize", checkMobile);
    }
    // SSR: rien à nettoyer
    return () => {};
  }, []);

  const isHome = pathname === "/";
  const isProgress = pathname === "/progression";
  const isTraining = pathname === "/entrainement";
  const isDS = pathname.startsWith("/ds");
  const isLeaderboard = pathname === "/classement";
  const isSettings = pathname === "/parametres";
  const isAccount = pathname === "/compte";

  // Vérification des rôles (admin ou tuteur)
  const userRole = (profile as any)?.role;
  const isAdmin = userRole === "admin";
  const isTuteur = userRole === "tuteur";
  const hasDashboardAccess = isAdmin || isTuteur;

  const openConversionModal = () => setShowConversionModal(true);

  // Contenu de la barre de navigation (Sidebar Desktop OU Bottom Bar Mobile)
  const sidebarContent = (
    <>
      <SidebarIcon
        emoji={"🏠"}
        active={isHome}
        onClick={() => router.push("/")}
      />
      {isGuest ? (
        <LockedSidebarIcon emoji="📊" onUnlockClick={openConversionModal} className="tour-progress" />
      ) : (
        <SidebarIcon
          emoji="📊"
          active={isProgress}
          onClick={() => router.push("/progression")}
          className="tour-progress"
        />
      )}
      <SidebarIcon
        emoji="🏋️"
        active={isTraining}
        onClick={() => router.push("/entrainement")}
        className="tour-training"
      />
      {isGuest ? (
        <LockedSidebarIcon emoji="📝" onUnlockClick={openConversionModal} className="tour-ds" />
      ) : (
        <SidebarIcon
          emoji="📝"
          active={isDS}
          onClick={() => router.push("/ds")}
          className="tour-ds"
        />
      )}
      {isGuest ? (
        <LockedSidebarIcon emoji="🏆" onUnlockClick={openConversionModal} className="tour-leaderboard" />
      ) : (
        <SidebarIcon
          emoji={"🏆"}
          active={isLeaderboard}
          onClick={() => router.push("/classement")}
          className="tour-leaderboard"
        />
      )}

      {/* Espaceur : Uniquement sur Desktop pour pousser les réglages en bas */}
      {!isMobile && <div className="flex-1" />}

      {/* --- SECTION ADMIN (PC UNIQUEMENT) --- */}
      {!isMobile && hasDashboardAccess && (
        <>
          {isAdmin && (
            <>
              <SidebarIcon
                emoji="📢"
                active={pathname === "/feedback"}
                onClick={() => router.push("/feedback")}
              />
              <SidebarIcon
                emoji="🗂️"
                active={pathname === "/flashcards"}
                onClick={() => router.push("/flashcards")}
              />
            </>
          )}
          <SidebarIcon
            emoji="📈"
            active={pathname === "/admin/dashboard"}
            onClick={() => router.push("/admin/dashboard")}
          />
        </>
      )}

      {/* Icône Compte -> Uniquement sur Mobile */}
      {isMobile && (
        isGuest ? (
          <LockedSidebarIcon emoji="👤" onUnlockClick={openConversionModal} className="tour-account" />
        ) : (
          <SidebarIcon
            emoji={"👤"}
            active={isAccount}
            onClick={() => router.push("/compte")}
            className="tour-account"
          />
        )
      )}

      {isGuest ? (
        <LockedSidebarIcon emoji="⚙️" onUnlockClick={openConversionModal} className="tour-settings" />
      ) : (
        <SidebarIcon
          emoji="⚙️"
          active={isSettings}
          onClick={() => router.push("/parametres")}
          className="tour-settings"
        />
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-app-bg-deep via-app-bg-mid to-app-bg-soft flex flex-col">
      {/* Desktop Layout */}
      {!isMobile && (
        <div className="flex flex-1 min-h-screen">
          {/* Sidebar */}
          <div className="w-24 bg-app-surface-overlay/70 backdrop-blur-sm p-4 flex flex-col items-center gap-6 pt-8 fixed h-full z-10 border-r border-app-border/60">
            {sidebarContent}
          </div>

          {/* Main Content Wrapper (décalé de la largeur de la sidebar) */}
          <div className="flex-1 flex flex-col ml-24">
            {/* Header - Masqué en mode plein écran */}
            {!isFullScreen && (
              <div className="p-8 flex items-center justify-between">
                {/* Logo plus petit pour la page de progression */}
                <div className={isProgress ? "scale-75 origin-left" : ""}>
                  <Logo />
                </div>

                {/* User Profile Desktop (Gros bouton en haut à droite) */}
                {user && isGuest ? (
                  <button
                    onClick={openConversionModal}
                    className="tour-account flex items-center gap-3 bg-gradient-to-r from-indigo-600/80 to-purple-600/80 backdrop-blur-sm rounded-2xl px-6 py-3 shadow-lg hover:from-indigo-500/80 hover:to-purple-500/80 transition-all cursor-pointer"
                  >
                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                      <span className="text-xl">🎯</span>
                    </div>
                    <span
                      className="text-white"
                      style={{
                        fontFamily: "'Fredoka', sans-serif",
                        fontWeight: 600,
                        fontSize: "1.125rem",
                      }}
                    >
                      Créer un compte
                    </span>
                  </button>
                ) : user ? (
                  <button
                    onClick={() => router.push("/compte")}
                    className="tour-account flex items-center gap-3 bg-app-surface/80 backdrop-blur-sm rounded-2xl px-6 py-3 shadow-card-sm hover:bg-app-surface-elevated/90 transition-all cursor-pointer relative border border-app-border/40"
                  >
                    <AvatarDisplay
                      avatarId={profile?.avatar_id}
                      avatarColor={profile?.avatar_color}
                      size="sm"
                    />
                    <span
                      className="text-content-strong"
                      style={{
                        fontFamily: "'Fredoka', sans-serif",
                        fontWeight: 600,
                        fontSize: "1.125rem",
                      }}
                    >
                      {profile?.first_name && profile?.last_name
                        ? `${profile.first_name.toUpperCase()} ${profile.last_name.toUpperCase()}`
                        : profile?.first_name?.toUpperCase() ||
                          user.email?.split("@")[0].toUpperCase() ||
                          "UTILISATEUR"}
                    </span>
                  </button>
                ) : !loading ? (
                  <button
                    onClick={() => router.push("/auth/login")}
                    className="flex items-center gap-3 bg-app-surface/80 backdrop-blur-sm rounded-2xl px-6 py-3 shadow-card-sm hover:bg-app-surface-elevated/90 transition-all cursor-pointer border border-app-border/40"
                  >
                    <div className="w-12 h-12 bg-gradient-to-br from-gray-500 to-gray-700 rounded-xl flex items-center justify-center">
                      <User className="w-7 h-7 text-white" />
                    </div>
                    <span
                      className="text-content-strong"
                      style={{
                        fontFamily: "'Fredoka', sans-serif",
                        fontWeight: 600,
                        fontSize: "1.125rem",
                      }}
                    >
                      Se connecter
                    </span>
                  </button>
                ) : null}
              </div>
            )}

            {/* Zone centrale (Children) */}
            <main className="flex-1 w-full relative">{children}</main>

            {/* Footer Desktop */}
            {!isFullScreen && <Footer />}
          </div>
        </div>
      )}

      {/* Mobile Layout */}
      {isMobile && (
        <div className="flex flex-col flex-1 min-h-screen">
          {/* Header - Logo only */}
          {!isFullScreen && (
            <div className="p-6 flex items-center justify-center">
              <div className={isProgress ? "scale-75" : ""}>
                <Logo />
              </div>
            </div>
          )}

          {/* Central Area + Footer */}
          <div
            className={`flex-1 flex flex-col ${!isFullScreen ? "pb-24" : ""}`}
          >
            <main className="flex-1">{children}</main>

            {/* Footer Mobile */}
            {!isFullScreen && <Footer />}
          </div>

          {/* Bottom Navigation Bar */}
          {!isFullScreen && (
            <div className="fixed bottom-0 left-0 right-0 bg-app-surface-overlay/90 backdrop-blur-md p-4 flex items-center justify-around gap-2 border-t border-app-border/60 z-50">
              {sidebarContent}
            </div>
          )}
        </div>
      )}
      {/* When a duel we created is accepted, redirect to the duel page */}
      <DuelAcceptedRedirect />
      {/* Global duel notifications (fixed top-right) */}
      <DuelNotifications />
      {/* Modal de conversion invité */}
      <GuestConversionModal
        isOpen={showConversionModal}
        onClose={() => setShowConversionModal(false)}
      />
    </div>
  );
}
