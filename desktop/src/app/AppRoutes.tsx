import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AUTH_CHANGED_EVENT, getAccessToken } from "@/auth";
import { SessionGate } from "./SessionGate";
import { Shell } from "./Shell";
import { LoginPage } from "@/features/account/LoginPage";
import { SettingsPage } from "@/features/account/SettingsPage";

function ProtectedShell() {
  const location = useLocation();
  if (!getAccessToken()) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return (
    <SessionGate>
      <Shell />
    </SessionGate>
  );
}

function SettingsRoute() {
  if (!getAccessToken()) {
    return (
      <main className="standalone-settings">
        <SettingsPage />
      </main>
    );
  }
  return (
    <SessionGate>
      <Shell />
    </SessionGate>
  );
}

export function AppRoutes() {
  const queryClient = useQueryClient();
  const [, setAuthRevision] = useState(0);

  useEffect(() => {
    const update = () => {
      queryClient.clear();
      setAuthRevision((value) => value + 1);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, update);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, update);
  }, [queryClient]);

  return (
    <Routes>
      <Route
        path="/login"
        element={getAccessToken() ? <Navigate to="/view/inbox" replace /> : <LoginPage />}
      />
      <Route path="/view/:view" element={<ProtectedShell />} />
      <Route path="/list/:listId" element={<ProtectedShell />} />
      <Route path="/profile" element={<ProtectedShell />} />
      <Route path="/settings" element={<SettingsRoute />} />
      <Route path="*" element={<Navigate to="/view/inbox" replace />} />
    </Routes>
  );
}