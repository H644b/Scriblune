"use client";
import { ThemeToggle } from "@/components/theme";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Flag, Users, Layers, History } from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { StaffAccess } from "@/lib/community";
import { Logo } from "./brand";
import { StaffBadge } from "./community-shared";
import { StaffManager } from "./staff-manager";
import { BillingManager } from "./billing-manager";
import { OwnerInbox } from "./owner-inbox";
import { SignupManager } from "./signup-manager";
import { AccountManager } from "./account-manager";
import {
  ForumModeration,
  moderationSections,
  type ModerationSection,
} from "./forum-moderation";
import { TestLab } from "./test-tools";
import { AdminPanel } from "./admin-panel";
import { PrivacyQueue } from "./privacy-queue";
import dynamic from "next/dynamic";
const VMConsolePanel = dynamic(
  () => import("./vm-console").then((m) => m.VMConsolePanel),
  { ssr: false },
);
export function StaffWorkspace({ access }: { access: StaffAccess }) {
  const search = useSearchParams();
  const tabs = [
    ...(access.owner ? [{ id: "waitlist", label: "Signups & waitlist" }] : []),
    ...(access.owner || access.roles.includes("admin")
      ? [{ id: "accounts", label: "Accounts" }]
      : []),
    ...(access.owner ? [{ id: "requests", label: "Owner notes" }] : []),
    ...(access.permissions.includes("feedback.read")
      ? [{ id: "feedback", label: "Feedback" }]
      : []),
    ...(access.owner ? [{ id: "staff", label: "Staff & roles" }] : []),
    ...(access.owner ? [{ id: "billing", label: "Plans & credits" }] : []),
    ...(access.owner ? [{ id: "console", label: "VM console" }] : []),
    ...(access.permissions.includes("forum.moderate")
      ? [{ id: "moderation", label: "Forum Moderation" }]
      : []),
    ...(access.permissions.includes("testing.tools")
      ? [{ id: "testing", label: "Test lab" }]
      : []),
    ...(access.owner || access.permissions.includes("privacy.manage")
      ? [{ id: "privacy", label: "Privacy requests" }]
      : []),
  ];
  const [tab, setTab] = useState(
    tabs.find((t) => t.id === search.get("tab"))?.id || tabs[0]?.id || "none",
  );
  const [moderation, setModeration] = useState<ModerationSection>(
    moderationSections.find((s) => s.id === search.get("section"))?.id ||
      "reports",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  function selectModeration(section: ModerationSection) {
    setTab("moderation");
    setModeration(section);
    setMenuOpen(false);
    history.replaceState(null, "", `/admin?tab=moderation&section=${section}`);
  }
  const sectionIcons = {
    reports: Flag,
    access: Users,
    categories: Layers,
    history: History,
  };
  return (
    <div className="staff-shell">
      <header className="desk-header">
        <Logo />
        <nav>
          <ThemeToggle />
          <Link href="/forum">Community</Link>
          <Link href="/account">Account</Link>
          <Link href="/desk">My desk</Link>
        </nav>
      </header>
      <main className="staff-main">
        <div className="section-heading">
          <div>
            <span className="eyebrow">BEHIND THE STUDY DESK</span>
            <h1>Feedback & staff.</h1>
            <p>Your tools, together in one place.</p>
          </div>
          <StaffBadge
            badge={
              access.owner
                ? "owner"
                : access.permissions.includes("forum.moderate")
                  ? "mod"
                  : "staff"
            }
          />
        </div>
        <nav className="staff-tabs" aria-label="Staff tools">
          {tabs.map((t) =>
            t.id === "moderation" ? (
              <div
                className="staff-moderation-menu"
                key={t.id}
                ref={menu}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setMenuOpen(true);
                }}
                onPointerLeave={(e) => {
                  if (
                    e.pointerType === "mouse" &&
                    !menu.current?.contains(document.activeElement)
                  )
                    setMenuOpen(false);
                }}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget))
                    setMenuOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setMenuOpen(false);
                    trigger.current?.focus();
                    e.stopPropagation();
                  }
                }}
              >
                <button
                  ref={trigger}
                  className="moderation-trigger"
                  aria-expanded={menuOpen}
                  aria-controls="moderation-sections"
                  aria-current={tab === t.id ? "page" : undefined}
                  onClick={() => setMenuOpen((v) => !v)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMenuOpen(true);
                      requestAnimationFrame(() =>
                        menu.current
                          ?.querySelector<HTMLButtonElement>(
                            ".moderation-dropdown button",
                          )
                          ?.focus(),
                      );
                    }
                  }}
                >
                  {t.label}
                  <ChevronDown size={15} />
                </button>
                {menuOpen && (
                  <div
                    className="moderation-dropdown"
                    id="moderation-sections"
                    aria-label="Forum moderation sections"
                  >
                    {moderationSections.map((s) => {
                      const Icon = sectionIcons[s.id];
                      return (
                        <button
                          key={s.id}
                          aria-current={
                            tab === "moderation" && moderation === s.id
                              ? "page"
                              : undefined
                          }
                          onClick={() => {
                            selectModeration(s.id);
                            trigger.current?.focus();
                          }}
                        >
                          <Icon size={18} />
                          <span>
                            <strong>{s.label}</strong>
                            <small>{s.description}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <button
                key={t.id}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => {
                  setTab(t.id);
                  setMenuOpen(false);
                  history.replaceState(null, "", `/admin?tab=${t.id}`);
                }}
              >
                {t.label}
              </button>
            ),
          )}
        </nav>
        {tab === "requests" && access.owner && (
          <OwnerInbox initialThread={search.get("thread") || ""} />
        )}
        {tab === "waitlist" && access.owner && <SignupManager />}
        {tab === "accounts" &&
          (access.owner || access.roles.includes("admin")) && (
            <AccountManager />
          )}
        {tab === "feedback" && (
          <AdminPanel
            canTriage={access.permissions.includes("feedback.triage")}
          />
        )}
        {tab === "staff" && <StaffManager />}
        {tab === "billing" && access.owner && <BillingManager />}
        {tab === "console" && access.owner && <VMConsolePanel />}
        {tab === "moderation" && (
          <ForumModeration
            section={moderation}
            onSectionChange={selectModeration}
          />
        )}
        {tab === "testing" && <TestLab />}
        {tab === "privacy" && <PrivacyQueue />}
        {tab === "none" && (
          <p>
            Your staff role currently has no tool permissions. Contact the owner
            to update it.
          </p>
        )}
      </main>
    </div>
  );
}
