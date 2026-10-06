"use client";
import { useEffect, useRef, useState } from "react";
import {
  TerminalSquare,
  Plug,
  Unplug,
  CornerDownLeft,
  Copy,
  Eraser,
} from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { ConsoleOutput, ConsoleRequest } from "@/lib/console-protocol";
import "@xterm/xterm/css/xterm.css";

const endpoint = "/api/owner/console";
async function request<T>(
  body: ConsoleRequest,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(35_000)])
      : AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The console connection failed.");
  return data;
}
function closeRemote(id: string) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "close", id }),
    keepalive: true,
  }).catch(() => {});
}
type Connection = {
  id: string;
  abort: AbortController;
  sequence: number;
  pending: number[];
  sending: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function VMConsolePanel() {
  const container = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    fit = useRef<FitAddon | null>(null);
  const connection = useRef<Connection | null>(null),
    mounted = useRef(false);
  const send = useRef<(data: Uint8Array) => void>(() => {});
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Ready to connect"),
    [error, setError] = useState("");

  function stop(message: string, notify = true) {
    const c = connection.current;
    connection.current = null;
    if (c) {
      clearTimeout(c.timer);
      c.abort.abort();
      if (notify) void closeRemote(c.id);
    }
    if (terminal.current) terminal.current.options.disableStdin = true;
    if (mounted.current) {
      setConnected(false);
      setStatus(message);
    }
  }
  async function flush(c: Connection) {
    if (connection.current !== c || c.sending || !c.pending.length) return;
    c.sending = true;
    try {
      while (connection.current === c && c.pending.length) {
        const bytes = c.pending.splice(0, 8192);
        await request(
          {
            action: "input",
            id: c.id,
            sequence: ++c.sequence,
            data: btoa(String.fromCharCode(...bytes)),
          },
          c.abort.signal,
        );
      }
    } catch (e) {
      if (connection.current === c) {
        setError((e as Error).message);
        stop("Connection ended");
      }
    } finally {
      c.sending = false;
    }
  }
  send.current = (bytes) => {
    const c = connection.current;
    if (!c) return;
    if (bytes.length > 8192 || c.pending.length + bytes.length > 32768) {
      setError("That paste is too large. Paste at most 8 KB at a time.");
      return;
    }
    c.pending.push(...bytes);
    // A bounded batch, not a debounce: continued typing cannot postpone input.
    if (!c.timer && !c.sending)
      c.timer = setTimeout(() => {
        c.timer = undefined;
        void flush(c);
      }, 8);
  };

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let resizeTimer: ReturnType<typeof setTimeout>;
    let instance: Terminal | undefined;
    const leave = () => stop("Disconnected");
    window.addEventListener("pagehide", leave);
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !container.current) return;
      const term = (instance = new Terminal({
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        fontSize: 14,
        cursorBlink: true,
        scrollback: 3000,
        screenReaderMode: true,
        disableStdin: true,
        theme: {
          background: "#111827",
          foreground: "#edf2fc",
          cursor: "#a7c4ff",
          selectionBackground: "#39537c",
          black: "#4b5563",
          brightBlack: "#9ca3af",
          blue: "#82aaff",
          brightBlue: "#b2ccff",
        },
      }));
      const addon = new FitAddon();
      term.loadAddon(addon);
      term.open(container.current);
      addon.fit();
      terminal.current = term;
      fit.current = addon;
      // No link, clipboard, or HTML addon: remote terminal bytes stay terminal data.
      term.parser.registerOscHandler(52, () => true);
      term.onData((data) => send.current(new TextEncoder().encode(data)));
      term.onBinary((data) =>
        send.current(Uint8Array.from(data, (c) => c.charCodeAt(0))),
      );
      term.writeln("Scriblune · Oracle VM\r\nConnect to open your SSH shell.");
      observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (disposed) return;
          addon.fit();
          const c = connection.current;
          if (c)
            void request(
              {
                action: "resize",
                id: c.id,
                cols: Math.max(20, Math.min(term.cols, 400)),
                rows: Math.max(5, Math.min(term.rows, 200)),
              },
              c.abort.signal,
            ).catch((e) => {
              if (connection.current === c) {
                setError(e.message);
                stop("Connection ended");
              }
            });
        }, 150);
      });
      observer.observe(container.current);
      setReady(true);
    })().catch(() => {
      if (!disposed)
        setError("The terminal could not load. Refresh this page to retry.");
    });
    return () => {
      disposed = true;
      mounted.current = false;
      stop("Disconnected");
      clearTimeout(resizeTimer);
      observer?.disconnect();
      instance?.dispose();
      terminal.current = null;
      fit.current = null;
      window.removeEventListener("pagehide", leave);
    };
    // The terminal owns its lifecycle; live input uses refs rather than rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    if (!terminal.current || busy) return;
    setBusy(true);
    setError("");
    setStatus("Connecting…");
    try {
      fit.current?.fit();
      const term = terminal.current;
      const result = await request<{ id: string }>({
        action: "open",
        cols: Math.max(20, Math.min(term.cols, 400)),
        rows: Math.max(5, Math.min(term.rows, 200)),
      });
      if (!mounted.current) {
        void closeRemote(result.id);
        return;
      }
      const c: Connection = {
        id: result.id,
        abort: new AbortController(),
        sequence: 0,
        pending: [],
        sending: false,
      };
      connection.current = c;
      term.reset();
      term.options.disableStdin = false;
      term.focus();
      setConnected(true);
      setStatus("Connected to Oracle VM");
      void (async () => {
        let cursor = 0;
        try {
          while (connection.current === c) {
            const result = await request<ConsoleOutput>(
              { action: "read", id: c.id, cursor },
              c.abort.signal,
            );
            if (connection.current !== c) break;
            for (const chunk of result.chunks) {
              await new Promise<void>((resolve) =>
                term.write(
                  Uint8Array.from(atob(chunk.data), (char) =>
                    char.charCodeAt(0),
                  ),
                  resolve,
                ),
              );
              cursor = chunk.sequence;
            }
            if (result.closed) {
              stop(result.reason || "Disconnected", false);
              break;
            }
          }
        } catch (e) {
          if (connection.current === c) {
            setError((e as Error).message);
            stop("Connection ended");
          }
        }
      })();
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setStatus("Could not connect");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="vm-console" aria-label="Owner VM console">
      <div className="vm-console-heading">
        <div>
          <span className="eyebrow">OWNER ACCESS</span>
          <h2>
            <TerminalSquare size={25} /> Oracle VM console
          </h2>
          <p>A live SSH shell on your production server.</p>
        </div>
        <button
          className={connected ? "button secondary" : "button primary"}
          disabled={!ready || busy}
          onClick={connected ? () => stop("Disconnected") : connect}
        >
          {connected ? <Unplug size={17} /> : <Plug size={17} />}
          {busy ? "Connecting…" : connected ? "Disconnect" : "Connect to VM"}
        </button>
      </div>
      <div className="vm-console-toolbar">
        <span
          className={connected ? "console-status online" : "console-status"}
          role="status"
        >
          {status}
        </span>
        <div>
          <button
            disabled={!connected}
            onClick={() => {
              send.current(new Uint8Array([3]));
              terminal.current?.focus();
            }}
            title="Interrupt the foreground command"
          >
            Ctrl+C
          </button>
          <button
            disabled={!connected}
            onClick={() => {
              send.current(new Uint8Array([9]));
              terminal.current?.focus();
            }}
          >
            Tab
          </button>
          <button
            disabled={!connected}
            onClick={() => {
              send.current(new Uint8Array([13]));
              terminal.current?.focus();
            }}
          >
            <CornerDownLeft size={14} />
            Enter
          </button>
          <button
            onClick={() => {
              const text = terminal.current?.getSelection();
              if (text)
                void navigator.clipboard
                  .writeText(text)
                  .catch(() =>
                    setError(
                      "Use your browser’s copy shortcut to copy the selection.",
                    ),
                  );
            }}
          >
            <Copy size={14} />
            Copy selection
          </button>
          <button onClick={() => terminal.current?.clear()}>
            <Eraser size={14} />
            Clear screen
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="vm-terminal"
        ref={container}
        aria-label="Interactive SSH terminal"
      />
      <p className="vm-console-note">
        Commands run as <code>opc</code> on the live VM. Connections close after
        10 minutes without input, after one hour, or when you leave this panel.
        Connection events are recorded; command text and output are not stored
        by Scriblune.
      </p>
    </section>
  );
}
