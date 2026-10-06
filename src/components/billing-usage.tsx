"use client";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { api } from "@/lib/client-api";
import type { Usage } from "@/lib/plans";
import { UsagePopover } from "./usage-popover";
export type BillingUsage = Usage & { checkoutAvailable: boolean };
export function useBilling(enabled = true) {
  return useQuery({
    queryKey: ["billing"],
    queryFn: () => api<BillingUsage>("/api/billing"),
    enabled,
    staleTime: 10000,
    refetchInterval: 60000,
    retry: 1,
  });
}
export function UpgradeLink() {
  const { data } = useBilling();
  const label =
    data?.plan.key === "focus" || data?.plan.key === "flex"
      ? "Plans"
      : "Upgrade";
  return (
    <Link href="/plans" className="upgrade-link">
      <Sparkles size={15} /> {label}
    </Link>
  );
}
export function UsageIndicator({
  demo = false,
  busy = false,
}: {
  demo?: boolean;
  busy?: boolean;
}) {
  const q = useBilling(!demo),
    previousBusy = useRef(busy);
  useEffect(() => {
    if (!demo && previousBusy.current !== busy) void q.refetch();
    previousBusy.current = busy;
  }, [busy, demo, q.refetch]);
  return (
    <UsagePopover
      usage={q.data}
      error={q.isError}
      refreshing={q.isFetching}
      demo={demo}
      onRefresh={() => void q.refetch()}
    />
  );
}
export function BillingSummary() {
  const q = useBilling();
  return (
    <section className="account-section billing-summary">
      <div className="billing-summary-title">
        <div>
          <span className="eyebrow">ROOM TO KEEP GOING</span>
          <h2>Your plan & credits</h2>
        </div>
        <UpgradeLink />
      </div>
      {q.data ? (
        <>
          <div className="billing-summary-numbers">
            <div>
              <b>{q.data.plan.name}</b>
              <span>
                {q.data.source === "owner"
                  ? "Granted by the Owner"
                  : "Your current plan"}
              </span>
            </div>
            <div>
              <b>{q.data.credits.available}</b>
              <span>credits available</span>
            </div>
            <div>
              <b>
                {q.data.sessions.remaining} / {q.data.sessions.limit}
              </b>
              <span>new sessions left today</span>
            </div>
          </div>
          <p>
            One tutor prompt uses one credit. {q.data.credits.bonus} bonus
            credits carry over. Daily allowances reset at midnight UTC.
          </p>
          <Link className="text-button" href="/plans">
            Compare plans & manage billing <ArrowUpRight size={15} />
          </Link>
        </>
      ) : (
        <p>{q.error?.message || "Loading your plan…"}</p>
      )}
    </section>
  );
}
