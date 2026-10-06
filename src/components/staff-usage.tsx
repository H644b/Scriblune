"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import type { UsageSnapshot } from "@/lib/plans";
import { UsagePopover } from "./usage-popover";

export function StaffUsage({
  account,
  label,
  revision,
}: {
  account: string;
  label: string;
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["staff-account-usage", account, revision],
    queryFn: ({ signal }) =>
      api<UsageSnapshot>(
        `/api/staff/accounts/usage?account=${encodeURIComponent(account)}`,
        { signal },
      ),
    enabled: open,
    staleTime: 10000,
    gcTime: 60000,
    refetchInterval: open ? 60000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return (
    <UsagePopover
      usage={q.data}
      error={q.isError}
      refreshing={q.isFetching}
      accountLabel={label}
      placement="below"
      onOpenChange={setOpen}
      onRefresh={() => void q.refetch()}
    />
  );
}
