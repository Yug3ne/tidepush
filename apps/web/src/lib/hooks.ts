import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { errorMessage } from "./api";

/**
 * Loads data with TanStack Query under `key`. When the route's loader already
 * fetched the same key (on the server, during SSR), the page renders with it
 * straight away. Keeps the last data while reloading.
 */
export function useLoad<T>(key: QueryKey, fn: () => Promise<T>) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: fn, placeholderData: (previous) => previous });
  const reload = useCallback(() => query.refetch().then(() => undefined), [query]);
  const setData = useCallback((data: T) => queryClient.setQueryData(key, data), [queryClient, key]);
  return {
    data: query.data ?? null,
    error: query.error ? errorMessage(query.error) : null,
    loading: query.isFetching,
    reload,
    setData,
  };
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Tidepush` : "Tidepush";
  }, [title]);
}
