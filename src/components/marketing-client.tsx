"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowUp,
  Check,
  FileText,
  Highlighter,
  MousePointer2,
  Pencil,
  Plus,
  Play,
  Sparkles,
  Undo2,
  ZoomIn,
} from "lucide-react";
import { AuthModal } from "./auth-modal";
import { Logo, Mark } from "./brand";
import { SamplePage } from "./sample-page";
import { browserAuth } from "@/lib/supabase/browser";
import { api } from "@/lib/client-api";
export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  async function start() {
    try {
      const { data } = await browserAuth().auth.getUser();
      if (data.user) {
        router.push("/desk");
        return;
      }
    } catch {}
    setOpen(true);
  }
  return (
    <>
      <header className="site-header">
        <Logo />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#shared-ink">The workspace</a>
          <a href="/features/memory-pins">Made for your mind</a>
        </nav>
        <div className="header-actions">
          <button className="text-button" onClick={() => setOpen(true)}>
            Sign in
          </button>
          <button className="button small ink" onClick={start}>
            Find your flow <Sparkles size={15} />
          </button>
        </div>
      </header>
      <AuthModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          router.push("/desk");
        }}
      />
    </>
  );
}
export function StartButton({
  label = "Start a tutoring session",
  className = "primary",
}: {
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function create() {
    setBusy(true);
    try {
      const s = await api<{ id: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "A new beginning", adult: true }),
      });
      router.push(`/study/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    const { data } = await browserAuth().auth.getUser();
    if (data.user) await create();
    else setOpen(true);
  }
  return (
    <>
      <button className={`button ${className}`} onClick={start} disabled={busy}>
        {busy ? "Opening your desk…" : label}
        <Sparkles size={17} />
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      <AuthModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          void create();
        }}
      />
    </>
  );
}
export function MiniWorkspace() {
  const [drawn, setDrawn] = useState(true);
  return (
    <div className="mini-desk">
      <div className="mini-desk-top">
        <span className="desk-dot" />
        <span>Finding your balance</span>
        <span className="mini-saved">
          <Check size={12} /> Sample session
        </span>
        <div className="mini-avatars">
          <span>You</span>
          <span>
            <Mark size={18} />
          </span>
        </div>
      </div>
      <div className="mini-desk-body">
        <div className="mini-canvas">
          <div className="mini-canvas-meta">
            <FileText size={13} /> Algebra practice.pdf <span>1 / 2</span>
          </div>
          <div className="mini-page">
            <SamplePage annotated={drawn} />
          </div>
          <div className="mini-toolbar">
            <MousePointer2 size={17} />
            <span className="selected">
              <Pencil size={18} />
            </span>
            <Highlighter size={18} />
            <span className="toolbar-separator" />
            <span className="color-dot blue" />
            <span className="color-dot terracotta" />
            <span className="toolbar-separator" />
            <Undo2 size={16} />
          </div>
          <div className="paper-tab">Room to think.</div>
        </div>
        <div className="mini-chat">
          <div className="mini-chat-header">
            <span className="tutor-avatar">
              <Mark size={25} />
            </span>
            <div>
              <strong>Scriblune AI Tutor</strong>
              <span>A sample of thinking together</span>
            </div>
          </div>
          <div className="mini-messages">
            <span className="chat-day">LET’S WORK THROUGH IT</span>
            <div className="bubble student">
              I know I need to find x, but where do I start?
            </div>
            <div className="bubble tutor">
              Let’s take it one step at a time. Think of this equation as a
              balanced scale.
            </div>
            <div className="bubble tutor">
              See the <strong>+ 6</strong> I circled? What could we do to get 3x
              on its own?
            </div>
            <div className="message-reference">
              <Pencil size={13} /> Looking at question 1
            </div>
            <div className="bubble student short">
              Subtract 6 from both sides?
            </div>
            <div className="bubble tutor">
              Exactly. Same change, both sides. Now you’re left with{" "}
              <strong>3x = 12</strong>.<br />
              <br />
              What’s your next move?
            </div>
          </div>
          <div className="sample-composer">
            <span>Your next lightbulb moment…</span>
            <span>
              <ArrowUp size={17} />
            </span>
          </div>
          <button
            className="replay-demo"
            onClick={() => {
              setDrawn(false);
              requestAnimationFrame(() => setDrawn(true));
            }}
          >
            <Play size={12} /> Replay sample drawing
          </button>
        </div>
      </div>
      <div className="mini-desk-bottom">
        <span>
          <span className="status-dot" /> Two minds. One page.
        </span>
        <span>Illustrative sample · no private content</span>
        <ZoomIn size={13} />
      </div>
    </div>
  );
}
export function ResumeAuth() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("signin")) setOpen(true);
  }, []);
  return (
    <AuthModal
      open={open}
      onClose={() => setOpen(false)}
      onSuccess={() => {
        const next = new URLSearchParams(location.search).get("next");
        location.href =
          next &&
          /^\/(study\/[0-9a-f-]+|feedback\/[0-9a-f-]+|desk|account|admin)$/.test(
            next,
          )
            ? next
            : "/desk";
      }}
    />
  );
}
