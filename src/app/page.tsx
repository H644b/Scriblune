import Link from "next/link";
import {
  FileUp,
  PenLine,
  Scan,
  Layers3,
  Pin,
  CheckCheck,
  MessageCircle,
  RotateCcw,
  LockKeyhole,
  Leaf,
} from "lucide-react";
import {
  MarketingHeader,
  MiniWorkspace,
  StartButton,
  ResumeAuth,
} from "@/components/marketing-client";
import { Logo, Mark } from "@/components/brand";
import { brand } from "@/lib/brand";
export const metadata = { alternates: { canonical: "/" } };
export default function Home() {
  return (
    <>
      <MarketingHeader />
      <main id="main-content">
        <section className="hero">
          <div className="hero-heading">
            <span className="eyebrow">
              <span className="tiny-orbit" /> A LITTLE GUIDANCE. A LOT OF
              POSSIBILITY.
            </span>
            <h1>
              Your assignment.
              <br />A shared page.
              <br />
              <em>A way forward.</em>
            </h1>
            <p>
              Not just an answer. That moment it clicks.
              <br />
              An AI tutor that sees your work, draws alongside you,
              <br className="desktop-only" /> and helps you find your own way
              through.
            </p>
            <div className="hero-actions">
              <StartButton />
              <Link href="/demo" className="button secondary">
                Explore the workspace
              </Link>
            </div>
            <div className="hero-note">
              <LockKeyhole size={13} /> Your work stays yours. Your pace sets
              the rhythm.
            </div>
          </div>
          <div className="hero-workspace">
            <div className="margin-note">
              Less “I’m stuck.”
              <br />
              More “I get it.”
              <svg viewBox="0 0 100 55" fill="none">
                <path
                  d="M5 6q25 42 73 29m-10-7 10 7-10 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <MiniWorkspace />
          </div>
          <div className="subject-strip">
            <span>A FRESH PERSPECTIVE ON</span>
            <span>
              Math <small>×</small> Science <small>×</small> Reading{" "}
              <small>×</small> Writing <small>×</small> The bigger picture
            </span>
          </div>
        </section>
        <section className="how-section section-wrap" id="how-it-works">
          <div className="section-heading">
            <span className="eyebrow">FROM STUCK TO STARTED</span>
            <h2>
              Bring the messy middle.
              <br />
              We’ll make room for it.
            </h2>
            <p>
              A half-finished worksheet. A confusing diagram. That one question
              you’ve read six times. Start right there.
            </p>
          </div>
          <div className="how-steps">
            <article>
              <span className="step-number">01</span>
              <FileUp />
              <h3>Bring your page.</h3>
              <p>
                Drop in a PDF or a photo of your assignment. Your actual work
                becomes the starting point.
              </p>
              <Link href="/features/bring-your-page">
                Meet your shared page
              </Link>
            </article>
            <article>
              <span className="step-number">02</span>
              <PenLine />
              <h3>Think out loud.</h3>
              <p>
                Ask, circle, sketch, try. Your tutor follows your thinking and
                adds a little ink of its own.
              </p>
              <Link href="/features/shared-ink">See how shared ink works</Link>
            </article>
            <article>
              <span className="step-number">03</span>
              <Leaf />
              <h3>Make it click.</h3>
              <p>
                Find the next step, understand the why, and leave with something
                that’s yours: understanding.
              </p>
              <Link href="/features/hint-ladder">
                Take it one hint at a time
              </Link>
            </article>
          </div>
        </section>
        <section className="ink-section" id="shared-ink">
          <div className="ink-demo">
            <div className="ink-note">
              <span className="eyebrow">A SHARED PEN, NOT JUST A CHAT</span>
              <div className="diagram-equation">“Why this part?”</div>
              <svg
                viewBox="0 0 460 200"
                aria-label="A sample diagram connects a claim to two pieces of evidence"
              >
                <g fill="none" stroke="var(--blue)" strokeWidth="2">
                  <rect x="162" y="25" width="140" height="54" rx="9" />
                  <path d="M232 79V112H88v23m144-23h144v23" />
                  <rect x="24" y="135" width="128" height="46" rx="8" />
                  <rect x="310" y="135" width="128" height="46" rx="8" />
                </g>
                <g
                  fill="var(--ink)"
                  textAnchor="middle"
                  fontFamily="Georgia"
                  fontSize="18"
                >
                  <text x="232" y="59">
                    Your claim
                  </text>
                  <text x="88" y="164">
                    Evidence 1
                  </text>
                  <text x="374" y="164">
                    Evidence 2
                  </text>
                </g>
              </svg>
              <span className="handwritten">Let’s connect the dots.</span>
            </div>
          </div>
          <div className="ink-copy">
            <span className="eyebrow">SHARED INK + POINT & ASK</span>
            <h2>
              Sometimes,
              <br />a little ink
              <br />
              <em>says it best.</em>
            </h2>
            <p>
              Circle the confusing part. Watch an idea take shape. Your tutor
              can point, underline, draw a graph, or connect two thoughts—right
              on your page.
            </p>
            <p>
              Your work and your tutor’s annotations stay on separate layers.
              Keep what helps. Hide what doesn’t.
            </p>
            <div className="inline-links">
              <Link href="/features/shared-ink">Discover Shared Ink</Link>
              <Link href="/features/point-and-ask">Try Point & Ask</Link>
            </div>
          </div>
        </section>
        <section className="section-wrap your-pace" id="your-pace">
          <span className="eyebrow">A LITTLE MORE YOU</span>
          <h2>
            There’s more than one
            <br />
            way to understand.
          </h2>
          <div className="feature-list">
            {[
              {
                n: "01",
                title: "A hint. Then another. Then a little less help.",
                text: "Choose a nudge, a strategy, a guided step, or a worked example. You decide how much help you want.",
                slug: "hint-ladder",
                icon: Layers3,
              },
              {
                n: "02",
                title: "A different route to the same lightbulb.",
                text: "When an explanation doesn’t land, switch the approach. Try a picture, an analogy, or smaller steps.",
                slug: "strategy-switch",
                icon: RotateCcw,
              },
              {
                n: "03",
                title: "The thread of your thinking, kept close.",
                text: "Pin a goal or preference. Come back to the method you tried and the question you were working through.",
                slug: "memory-pins",
                icon: Pin,
              },
            ].map((f) => (
              <article key={f.slug}>
                <span className="feature-number">{f.n}</span>
                <f.icon />
                <div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
                <Link
                  href={`/features/${f.slug}`}
                  aria-label={`Explore ${f.slug.replaceAll("-", " ")}`}
                >
                  Explore
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section className="finish-section section-wrap">
          <div>
            <span className="eyebrow">LEAVE WITH A LITTLE MORE CLARITY</span>
            <h2>
              From the first question
              <br />
              to your final look.
            </h2>
          </div>
          <div className="finish-features">
            <article>
              <CheckCheck />
              <h3>A thoughtful second look.</h3>
              <p>
                Review your work against a rubric you provide or a checklist you
                confirm. Understand what’s ready and what needs attention.
              </p>
              <Link href="/features/rubric-lens">Rubric Lens</Link>
            </article>
            <article>
              <RotateCcw />
              <h3>Pick up your thinking.</h3>
              <p>
                Return to a saved session and replay the explanations that
                helped. Your page is right where you left it.
              </p>
              <Link href="/features/resume-and-replay">Resume & Replay</Link>
            </article>
            <article>
              <MessageCircle />
              <h3>Your experience matters.</h3>
              <p>
                Tell the team what helped and what didn’t. Session-specific
                feedback stays private to authorized Scriblune staff.
              </p>
              <Link href="/features/private-feedback">Private Feedback</Link>
            </article>
          </div>
        </section>
        <section className="closing-note">
          <Mark size={49} />
          <span className="eyebrow">
            YOU DON’T HAVE TO HAVE IT FIGURED OUT.
          </span>
          <h2>Just bring your page.</h2>
          <StartButton label="Let’s work it out" />
          <p>PDF, PNG, JPEG & WebP</p>
        </section>
      </main>
      <footer className="site-footer">
        <Logo />
        <span>{brand.tagline}</span>
        <nav aria-label="Footer">
          <Link href="/forum">Community forum</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/plans">Plans & pricing</Link>
          <Link href="/terms">Terms & limitations</Link>
        </nav>
        <span>
          © {new Date().getFullYear()} Scriblune · Built by{" "}
          <a
            href="https://teriontic.tech"
            target="_blank"
            rel="noopener noreferrer"
          >
            Teriontic
          </a>
        </span>
      </footer>
      <ResumeAuth />
    </>
  );
}
