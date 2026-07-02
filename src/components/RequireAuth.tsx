import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { authApi } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";

// Gates protected routes. When auth isn't configured (local/mock builds), it's
// a no-op so development stays frictionless. When configured, unauthenticated
// visitors are redirected to /login.
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    if (status === "loading") refresh();
  }, [status, refresh]);

  if (!authApi.configured) return <>{children}</>;
  if (status === "loading") return <AuthSplash />;
  if (status === "anon") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthSplash() {
  return (
    <div className="grid min-h-[100dvh] place-items-center">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-[pulse-dot_1.2s_ease-in-out_infinite] rounded-full bg-fog"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
