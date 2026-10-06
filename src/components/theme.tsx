"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
export type ThemePreference = "light" | "dark" | "system";
type Theme = {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (value: ThemePreference) => void;
};
const key = "scriblune-appearance";
const Context = createContext<Theme>({
  preference: "system",
  resolved: "light",
  setPreference: () => {},
});
const choices = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, savePreference] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let current: ThemePreference = "system";
    const apply = () => {
      const theme =
        current === "system" ? (media.matches ? "dark" : "light") : current;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.appearance = current;
      savePreference(current);
      setResolved(theme);
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) =>
          meta.setAttribute(
            "content",
            theme === "dark" ? "#191d24" : "#f7f3eb",
          ),
        );
    };
    const read = () => {
      try {
        const saved = localStorage.getItem(key);
        current = saved === "light" || saved === "dark" ? saved : "system";
      } catch {
        current = "system";
      }
      apply();
    };
    const change = (e: Event) => {
      current = (e as CustomEvent<ThemePreference>).detail;
      apply();
    };
    const storage = (e: StorageEvent) => {
      if (e.key === key || e.key === null) read();
    };
    read();
    media.addEventListener("change", apply);
    window.addEventListener("scriblune-theme", change);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("scriblune-theme", change);
      window.removeEventListener("storage", storage);
    };
  }, []);
  function setPreference(value: ThemePreference) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Theme still works when device storage is unavailable. */
    }
    window.dispatchEvent(new CustomEvent("scriblune-theme", { detail: value }));
  }
  return (
    <Context.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </Context.Provider>
  );
}
export const useTheme = () => useContext(Context);
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    id = useId();
  const popover = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const menu = popover.current;
      if (!menu) return;
      menu.style.translate = "0px";
      const bounds = menu.getBoundingClientRect();
      const offset =
        bounds.left < 12
          ? 12 - bounds.left
          : Math.min(0, innerWidth - 12 - bounds.right);
      menu.style.translate = `${offset}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="theme-control"
      ref={ref}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          button.current?.focus();
          e.stopPropagation();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="icon-button theme-toggle"
        aria-label="Choose appearance"
        title="Choose appearance"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <Sun className="theme-sun" size={18} />
        <Moon className="theme-moon" size={18} />
      </button>
      {open && (
        <div
          ref={popover}
          id={id}
          className="theme-popover"
          role="group"
          aria-label="Appearance"
        >
          <span>Make yourself comfortable</span>
          {choices.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              key={value}
              aria-pressed={preference === value}
              onClick={() => {
                setPreference(value);
                setOpen(false);
                button.current?.focus();
              }}
            >
              <Icon size={16} />
              {label}
              {preference === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();
  return (
    <section className="account-section appearance-settings">
      <span className="eyebrow">SETTLE INTO YOUR SPACE</span>
      <h2>Appearance</h2>
      <p>
        A brighter desk by day, a softer glow at night. Choose your look for
        this device.
      </p>
      <div
        className="appearance-choices"
        role="group"
        aria-label="Appearance preference"
      >
        {choices.map(({ value, label, icon: Icon }) => (
          <button
            type="button"
            key={value}
            aria-pressed={preference === value}
            onClick={() => setPreference(value)}
          >
            <span className={`appearance-preview ${value}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <Icon size={16} />
              {label}
              {preference === value && <Check size={16} />}
            </span>
          </button>
        ))}
      </div>
      <small>System follows your device’s light or dark setting.</small>
    </section>
  );
}
