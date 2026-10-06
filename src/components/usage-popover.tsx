"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import type { UsageSnapshot } from "@/lib/plans";

export function UsagePopover({
  usage,
  error = false,
  refreshing = false,
  demo = false,
  accountLabel,
  placement = "above",
  onOpenChange,
  onRefresh,
}: {
  usage?: UsageSnapshot;
  error?: boolean;
  refreshing?: boolean;
  demo?: boolean;
  accountLabel?: string;
  placement?: "above" | "below";
  onOpenChange?: (open: boolean) => void;
  onRefresh?: () => void;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    control = useRef<HTMLDivElement>(null),
    hover = useRef(false),
    leave = useRef<ReturnType<typeof setTimeout> | null>(null),
    [open, setOpen] = useState(false);
  const current = error ? undefined : usage;
  const available = current?.credits.available;
  const fraction =
    current && current.plan.prompts > 0
      ? current.credits.included / current.plan.prompts
      : demo
        ? 1
        : 0;
  const label = accountLabel
    ? `Limits for ${accountLabel}`
    : "Credits and daily usage";
  function cancelLeave() {
    if (leave.current) clearTimeout(leave.current);
    leave.current = null;
  }
  function hide() {
    cancelLeave();
    hover.current = false;
    panel.current?.hidePopover();
  }
  function pointerLeave() {
    cancelLeave();
    if (hover.current)
      leave.current = setTimeout(() => {
        if (!control.current?.contains(document.activeElement)) hide();
      }, 150);
  }
  useEffect(() => () => cancelLeave(), []);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = trigger.current,
        popup = panel.current;
      if (!button || !popup) return;
      const anchor = button.getBoundingClientRect(),
        box = popup.getBoundingClientRect();
      const margin = 12,
        gap = 9;
      const left = Math.max(
        margin,
        Math.min(
          placement === "below" ? anchor.right - box.width : anchor.left,
          window.innerWidth - box.width - margin,
        ),
      );
      const above = anchor.top - box.height - gap,
        below = anchor.bottom + gap;
      const preferred = placement === "above" ? above : below;
      const alternate = placement === "above" ? below : above;
      const fits = (top: number) =>
        top >= margin && top + box.height <= window.innerHeight - margin;
      const top = fits(preferred)
        ? preferred
        : fits(alternate)
          ? alternate
          : Math.max(
              margin,
              Math.min(preferred, window.innerHeight - box.height - margin),
            );
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    position();
    const resize = new ResizeObserver(position);
    if (panel.current) resize.observe(panel.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, placement]);
  return (
    <div
      ref={control}
      className="usage-control"
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          hide();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`icon-button usage-ring ${available === 0 && !demo ? "usage-empty" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        popoverTarget={id}
        onPointerEnter={(event) => {
          cancelLeave();
          if (
            event.pointerType === "mouse" &&
            !panel.current?.matches(":popover-open")
          ) {
            hover.current = true;
            panel.current?.showPopover();
          }
        }}
        onPointerLeave={pointerLeave}
        onClick={(event) => {
          // A mouse hover already opened it: the first click pins it open.
          if (hover.current && panel.current?.matches(":popover-open"))
            event.preventDefault();
          cancelLeave();
          hover.current = false;
        }}
      >
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" className="usage-track" />
          <circle
            cx="18"
            cy="18"
            r="15"
            className="usage-progress"
            pathLength="100"
            strokeDasharray={`${Math.max(0, Math.min(1, fraction)) * 100} 100`}
          />
        </svg>
        <span>
          {demo
            ? "5"
            : available === undefined
              ? "·"
              : available > 99
                ? "99+"
                : available}
        </span>
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="usage-popover"
        role="dialog"
        aria-label={
          accountLabel
            ? `Plan and usage for ${accountLabel}`
            : "Your plan and usage"
        }
        onToggle={(event) => {
          const visible = event.newState === "open";
          setOpen(visible);
          onOpenChange?.(visible);
          if (!visible) {
            hover.current = false;
            cancelLeave();
          }
        }}
        onPointerEnter={cancelLeave}
        onPointerLeave={pointerLeave}
      >
        <div className="usage-popover-heading">
          <strong>
            {demo
              ? "A little progress, every day."
              : current?.plan.name || "Plan & usage"}
          </strong>
          <button
            type="button"
            className="icon-button usage-close"
            aria-label="Close usage popup"
            onClick={() => {
              hide();
              trigger.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        </div>
        {accountLabel && <p className="usage-account-label">{accountLabel}</p>}
        {demo ? (
          <>
            <p>Free includes 5 tutor credits and 1 new session each day.</p>
            <Link href="/plans">
              Compare plans <ArrowUpRight size={14} />
            </Link>
          </>
        ) : error ? (
          <div role="alert">
            <p>Usage couldn’t load. Retry to see the current allowance.</p>
            <button
              type="button"
              className="text-button"
              onClick={onRefresh}
              disabled={refreshing}
            >
              Retry
            </button>
          </div>
        ) : current ? (
          <>
            <div className="usage-credit-total">
              <b>{available}</b>
              <span>credits available</span>
            </div>
            <div className="usage-stat">
              <span>
                {current.sharedFree
                  ? "Shared daily credits left"
                  : "Daily credits left"}
              </span>
              <b>
                {current.credits.included} / {current.plan.prompts}
              </b>
            </div>
            <div className="usage-stat">
              <span>
                {accountLabel ? "Account bonus credits" : "Bonus credits"}
              </span>
              <b>{current.credits.bonus}</b>
            </div>
            <div className="usage-stat">
              <span>
                {current.sharedFree
                  ? "Shared new sessions left"
                  : "New sessions left"}
              </span>
              <b>
                {current.sessions.remaining} / {current.sessions.limit}
              </b>
            </div>
            {current.provisionalFree && (
              <p role="status">
                <strong>Provisional shared Free allowance.</strong> This is an
                uncertain match pending Admin review. An Administrator can lift
                the restriction.{" "}
                {accountLabel ? (
                  "Review this account’s allowance associations below."
                ) : (
                  <Link href="/account">
                    Request a review in Account settings
                  </Link>
                )}
              </p>
            )}
            {current.sharedFree && (
              <p>
                The daily Free allowance is shared across associated accounts.
                Bonus credits belong to this account.
              </p>
            )}
            {available === 0 && <p>No tutor credits left today.</p>}
            {current.source === "owner" && <p>Plan granted by the Owner.</p>}
            <p>
              1 prompt = 1 credit. Bonus credits carry over. Saved sessions,
              drawing tools, and the forum stay available.
            </p>
            <small>
              Daily limits reset{" "}
              {new Date(current.resetsAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              your time (midnight UTC).
            </small>
            {accountLabel ? (
              <button
                type="button"
                className="text-button usage-refresh"
                onClick={onRefresh}
                disabled={refreshing}
              >
                Refresh usage
              </button>
            ) : (
              <Link href="/plans">
                View plans & usage <ArrowUpRight size={14} />
              </Link>
            )}
            {refreshing && <small role="status">Refreshing usage…</small>}
          </>
        ) : (
          <p role="status">
            Loading {accountLabel ? "account" : "your"} allowance…
          </p>
        )}
      </div>
    </div>
  );
}
