import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { queryKeys } from "@/query";
import { getAccessToken, setStoredUser } from "@/auth";
import { errorMessage } from "@/lib/error-utils";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ConnectionError } from "@/components/ConnectionError";

export function SessionGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const query = useQuery({
    queryKey: queryKeys.auth,
    queryFn: api.me,
    retry: false,
  });

  useEffect(() => {
    if (query.data) setStoredUser(query.data);
  }, [query.data]);

  if (query.isPending) return <LoadingScreen />;
  if (query.isError) {
    if (!getAccessToken()) {
      return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
    }
    return (
      <ConnectionError
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        onOpenSettings={() => navigate("/settings")}
        pending={query.isFetching}
      />
    );
  }
  return children;
}