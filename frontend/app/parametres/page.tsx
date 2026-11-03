"use client";

import { Layout } from "@/app/components/Layout";
import { useAuth } from "@/app/contexts/AuthContext";
import { useTheme } from "next-themes";
import { supabase } from "@/app/lib/supabase";
import { Bell, Sliders, User } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAudioFeedback } from "../hooks/useAudioFeedback";
import { AccountTab } from "./components/AccountTab";
import { NotificationsTab } from "./components/NotificationsTab";
import { PreferencesTab } from "./components/PreferencesTab";
import { TabButton } from "./components/SettingsUI";

type Tab = "account" | "preferences" | "notifications";


export default function SettingsPage() {
  const { user, profile } = useAuth();
  const { theme, setTheme } = useTheme();
  const { playSlide } = useAudioFeedback();

  const [activeTab, setActiveTab] = useState<Tab>("account");
  const [loading, setLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // --- COMPTE ---
  const [formData, setFormData] = useState({ first_name: "", last_name: "" });
  const [passwordData, setPasswordData] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // --- PRÉFÉRENCES ---
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  // --- NOTIFICATIONS ---
  const [notifPushDuels, setNotifPushDuels] = useState(false);
  const [notifPushDaily, setNotifPushDaily] = useState(false);
  const [notifEmailDuels, setNotifEmailDuels] = useState(true);
  const [notifEmailDaily, setNotifEmailDaily] = useState(true);
  const [notifNewsletter, setNotifNewsletter] = useState(false);
  const [notifPermission, setNotifPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [notifLoading, setNotifLoading] = useState(false);

  // Chargement initial
  useEffect(() => {
    if (profile) {
      setFormData({
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
      });
      setNotifPushDuels(profile.notif_push_duels ?? false);
      setNotifPushDaily(profile.notif_push_daily ?? false);
      setNotifEmailDuels(profile.notif_email_duels ?? true);
      setNotifEmailDaily(profile.notif_email_daily ?? true);
      setNotifNewsletter(profile.notif_newsletter ?? false);
    }

    const savedSound = localStorage.getItem("novlearn-sound");
    if (savedSound !== null) setSoundEnabled(savedSound === "true");

    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
    } else {
      setNotifPermission("unsupported");
    }

    setIsLoaded(true);
  }, [profile]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("novlearn-sound", String(soundEnabled));
  }, [soundEnabled, isLoaded]);

  // --- HANDLERS COMPTE ---
  const handleUpdateInfo = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: formData.first_name,
          last_name: formData.last_name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user?.id);
      if (error) throw error;
      toast.success("Informations mises à jour !");
    } catch {
      toast.error("Erreur lors de la mise à jour du profil.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!passwordData.newPassword || !passwordData.oldPassword) {
      toast.error("Veuillez remplir tous les champs mot de passe.");
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("Les nouveaux mots de passe ne correspondent pas.");
      return;
    }
    if (passwordData.newPassword.length < 6) {
      toast.error("Le nouveau mot de passe est trop court (6 caractères min).");
      return;
    }

    setLoading(true);
    try {
      if (!user?.email) throw new Error("Utilisateur non identifié");

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: passwordData.oldPassword,
      });
      if (signInError) throw new Error("L'ancien mot de passe est incorrect.");

      const { error: updateError } = await supabase.auth.updateUser({
        password: passwordData.newPassword,
      });
      if (updateError) throw updateError;

      setPasswordData({ oldPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Mot de passe modifié avec succès !");
    } catch (error: any) {
      toast.error(error.message || "Erreur lors du changement de mot de passe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="flex-1 px-4 md:px-8 pb-12 overflow-y-auto bg-app-bg">
        <div className="max-w-4xl mx-auto pt-8 space-y-8">
          <h1
            className="text-3xl font-bold text-content-main mb-6"
            style={{ fontFamily: "'Fredoka', sans-serif" }}
          >
            Paramètres
          </h1>

          {/* Onglets */}
          <div className="flex flex-wrap gap-2 p-1 bg-app-surface/50 rounded-xl w-fit border border-app-border mb-6">
            <TabButton
              active={activeTab === "account"}
              onClick={() => setActiveTab("account")}
              icon={<User size={18} />}
              label="Compte & Sécurité"
            />
            <TabButton
              active={activeTab === "preferences"}
              onClick={() => setActiveTab("preferences")}
              icon={<Sliders size={18} />}
              label="Préférences App"
            />
            <TabButton
              active={activeTab === "notifications"}
              onClick={() => setActiveTab("notifications")}
              icon={<Bell size={18} />}
              label="Notifications"
            />
          </div>

          {activeTab === "account" && (
            <AccountTab
              formData={formData}
              setFormData={setFormData}
              passwordData={passwordData}
              setPasswordData={setPasswordData}
              showOldPass={showOldPass}
              setShowOldPass={setShowOldPass}
              showNewPass={showNewPass}
              setShowNewPass={setShowNewPass}
              loading={loading}
              onSaveInfo={handleUpdateInfo}
              onSavePassword={handleUpdatePassword}
            />
          )}

          {activeTab === "preferences" && (
            <PreferencesTab
              theme={theme}
              setTheme={setTheme}
              soundEnabled={soundEnabled}
              setSoundEnabled={setSoundEnabled}
              reduceMotion={reduceMotion}
              setReduceMotion={setReduceMotion}
              playSlide={playSlide}
            />
          )}

          {activeTab === "notifications" && (
            <NotificationsTab
              notifPushDuels={notifPushDuels}
              setNotifPushDuels={setNotifPushDuels}
              notifPushDaily={notifPushDaily}
              setNotifPushDaily={setNotifPushDaily}
              notifEmailDuels={notifEmailDuels}
              setNotifEmailDuels={setNotifEmailDuels}
              notifEmailDaily={notifEmailDaily}
              setNotifEmailDaily={setNotifEmailDaily}
              notifNewsletter={notifNewsletter}
              setNotifNewsletter={setNotifNewsletter}
              notifPermission={notifPermission}
              setNotifPermission={setNotifPermission}
              notifLoading={notifLoading}
              setNotifLoading={setNotifLoading}
              playSlide={playSlide}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
