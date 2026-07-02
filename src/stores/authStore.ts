import { create } from "zustand";
import { authApi } from "@/lib/auth";

export type AuthStatus = "loading" | "authed" | "anon";

interface AuthState {
  status: AuthStatus;
  sub: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  sub: null,

  refresh: async () => {
    const session = await authApi.getSession();
    if (session) set({ status: "authed", sub: session.sub });
    else set({ status: "anon", sub: null });
  },

  signOut: async () => {
    await authApi.signOut();
    set({ status: "anon", sub: null });
  },
}));
