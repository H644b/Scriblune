"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Paperclip,
  Square,
  Pin,
  Sparkles,
  Scan,
  Mic,
  VolumeX,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Mark } from "./brand";
import type { Message, Memory, Region } from "@/lib/workspace/types";
export function RichText({
  text,
  onReference,
}: {
  text: string;
  onReference?: (pageId: string, objectId?: string) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: "ignore", trust: false }]]}
      urlTransform={(url) =>
        url.startsWith("scriblune:")
          ? url
          : /^(https?:|mailto:|\/|#)/.test(url)
            ? url
            : ""
      }
      components={{
        a: ({ href, children }) =>
          href?.startsWith("scriblune:") ? (
            <button
              className="inline-reference"
              onClick={() => {
                const parts = href.replace("scriblune:", "").split("/");
                onReference?.(parts[1], parts[3]);
              }}
            >
              {children}
            </button>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
export function Chat({
  messages,
  streamText,
  activity,
  busy,
  onSend,
  onStop,
  onAttach,
  onReference,
  onMemories,
  memories,
  selection,
  demo,
  onSample,
  aiAvailable,
  readOnly,
}: {
  messages: Message[];
  streamText: string;
  activity: string;
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onAttach: () => void;
  onReference: (pageId: string, objectId?: string) => void;
  onMemories: () => void;
  memories: Memory[];
  selection: Region | null;
  demo: boolean;
  onSample: () => void;
  aiAvailable: boolean;
  readOnly: boolean;
}) {
  const [text, setText] = useState(""),
    [dictating, setDictating] = useState(false),
    [dictationAvailable, setDictationAvailable] = useState(false);
  const scroller = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    recognizer = useRef<any>(null);
  useEffect(() => {
    setDictationAvailable(
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    );
    return () => recognizer.current?.abort();
  }, []);
  useEffect(() => {
    if (nearBottom.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, streamText, activity]);
  function send() {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText("");
    nearBottom.current = true;
  }
  function dictate() {
    if (dictating) {
      recognizer.current?.stop();
      return;
    }
    const ctor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!ctor) return;
    const r = new ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (event: any) =>
      setText((t) => t + (t ? " " : "") + event.results[0][0].transcript);
    r.onend = () => setDictating(false);
    r.onerror = () => setDictating(false);
    recognizer.current = r;
    setDictating(true);
    r.start();
  }
  return (
    <aside className="chat-panel" aria-label="Tutoring conversation">
      <div className="chat-heading">
        <div className="tutor-avatar">
          <Mark size={28} />
        </div>
        <div>
          <h2>Scriblune AI Tutor</h2>
          <span aria-live="polite">
            {demo ? "Sample workspace" : activity || "Ready when you are"}
          </span>
        </div>
        <button
          className="icon-button"
          title="Memory pins"
          aria-label="Open memory pins"
          onClick={onMemories}
        >
          <Pin size={18} />
        </button>
      </div>
      {memories.some((m) => m.active) && (
        <button className="memory-peek" onClick={onMemories}>
          <Pin size={12} />
          {String(
            memories.find((m) => m.active)?.content.text ||
              "Your learning goals",
          )}
          <span>{memories.filter((m) => m.active).length}</span>
        </button>
      )}
      <div
        ref={scroller}
        className="chat-scroll"
        onScroll={() => {
          const el = scroller.current!;
          nearBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <span className="chat-date">A LITTLE GUIDANCE GOES A LONG WAY</span>
        {!messages.length && (
          <div className="chat-welcome">
            <Mark size={45} />
            <h3>Let’s find your next step.</h3>
            <p>
              Bring your page, then tell me where you’d like to start. You can
              also circle a part and ask about it.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id} className={`message ${m.role}`}>
            <div
              className={`bubble ${m.role === "student" ? "student" : "tutor"}`}
            >
              <RichText text={m.content} onReference={onReference} />
            </div>
            {m.references_json?.length > 0 && (
              <div className="message-refs">
                {m.references_json.slice(0, 4).map((r, i) => (
                  <button
                    key={i}
                    onClick={() => onReference(r.page_id, r.object_id)}
                  >
                    <Scan size={12} />
                    {r.label || "See this step"}
                  </button>
                ))}
              </div>
            )}
            <span className="message-time">
              {demo
                ? "Sample"
                : new Date(m.created_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
              {m.status === "interrupted"
                ? " · Stopped"
                : m.status === "failed"
                  ? " · Incomplete"
                  : ""}
              {!demo && m.role === "student" ? " · Saved" : ""}
            </span>
          </div>
        ))}
        {streamText && (
          <div className="message tutor">
            <div className="bubble tutor streaming">
              <RichText text={streamText} onReference={onReference} />
            </div>
          </div>
        )}
        {busy && !streamText && (
          <div className="thinking" role="status">
            <span />
            <span />
            <span />
            <small>{activity}</small>
          </div>
        )}
      </div>
      <div className="chat-bottom">
        {demo && (
          <div className="sample-chat-notice">
            <span>Explore with a scripted example.</span>
            <button
              className="button sample-play"
              onClick={onSample}
              disabled={busy}
            >
              <Sparkles size={15} /> Play sample explanation
            </button>
          </div>
        )}
        {!demo && !aiAvailable && (
          <div className="setup-inline">
            The AI tutor isn’t connected yet. Your page and drawing tools remain
            available.
          </div>
        )}
        {selection && (
          <div className="selection-context">
            <Scan size={13} /> Asking about your selection
          </div>
        )}
        {!demo && !busy && !readOnly && aiAvailable && (
          <div className="chat-suggestions">
            {[
              selection
                ? "Explain the part I selected."
                : "Give me a small hint.",
              "Show a different strategy.",
              "Check what I wrote.",
            ].map((t) => (
              <button key={t} onClick={() => onSend(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            aria-label="Message your tutor"
            placeholder={
              demo
                ? "Sign in to work with the AI tutor…"
                : readOnly
                  ? "This session is finished. Your thinking is saved."
                  : "What are you thinking?"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={demo || readOnly || !aiAvailable}
            rows={2}
            maxLength={8000}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-controls">
            <button
              type="button"
              className="icon-button"
              aria-label="Add a document or image"
              title="Add a document"
              onClick={onAttach}
            >
              <Paperclip size={18} />
            </button>
            {dictationAvailable && !demo && (
              <button
                type="button"
                className={`icon-button ${dictating ? "recording" : ""}`}
                aria-label={
                  dictating
                    ? "Stop dictation"
                    : "Dictate a message using your browser speech service"
                }
                title="Browser dictation may use your device provider’s service"
                onClick={dictate}
              >
                {dictating ? <VolumeX size={18} /> : <Mic size={18} />}
              </button>
            )}
            <span>
              {dictating
                ? "Listening…"
                : selection
                  ? "Selected region attached"
                  : "Shift + Enter for a new line"}
            </span>
            {busy ? (
              <button
                type="button"
                className="send-button stop"
                onClick={onStop}
                aria-label="Stop explanation"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                className="send-button"
                disabled={!text.trim() || demo || readOnly || !aiAvailable}
                aria-label="Send message"
              >
                <ArrowUp size={19} />
              </button>
            )}
          </div>
        </form>
        <p className="chat-footnote">
          AI can make mistakes. Your understanding comes first.
        </p>
      </div>
    </aside>
  );
}
