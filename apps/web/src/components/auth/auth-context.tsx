"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export type UserRole = "guest" | "customer" | "analyst" | "admin" | "super_admin";

export interface AuthUser {
  id: string;
  name?: string | null;
  email: string;
  role: UserRole;
  orgId?: string | null;
  orgName?: string | null;
  phoneVerified: boolean;
  status: string;
}

interface AuthContextType {
  user: AuthUser | null;
  role: UserRole;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAuthModalOpen: boolean;
  pendingActionTitle: string | null;
  isIncognito: boolean;
  toggleIncognito: () => void;
  setIncognito: (val: boolean) => void;
  openAuthModal: (actionTitle?: string, onComplete?: () => void) => void;
  closeAuthModal: () => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [pendingActionTitle, setPendingActionTitle] = useState<string | null>(null);
  const [onSuccessCallback, setOnSuccessCallback] = useState<(() => void) | null>(null);
  const [isIncognito, setIsIncognitoState] = useState(false);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const toggleIncognito = useCallback(() => {
    setIsIncognitoState((prev) => !prev);
  }, []);

  const setIncognito = useCallback((val: boolean) => {
    setIsIncognitoState(val);
  }, []);

  const openAuthModal = useCallback((actionTitle?: string, onComplete?: () => void) => {
    setPendingActionTitle(actionTitle || "Sign in to access institutional analysis");
    if (onComplete) setOnSuccessCallback(() => onComplete);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setPendingActionTitle(null);
    setOnSuccessCallback(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch (e) {
      console.error("Logout error:", e);
    }
    setUser(null);
    router.push("/");
    router.refresh();
  }, [router]);

  const role: UserRole = user?.role || "guest";
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isAuthenticated,
        isLoading,
        isAuthModalOpen,
        pendingActionTitle,
        isIncognito,
        toggleIncognito,
        setIncognito,
        openAuthModal,
        closeAuthModal,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
