import { ThemeToggle } from "@/components/theme";
import Link from "next/link";
import { Logo } from "@/components/brand";
export const metadata = {
  title: "Terms and limitations",
  alternates: { canonical: "/terms" },
};
export default function Page() {
  return (
    <>
      <header className="desk-header">
        <Logo />
        <Link href="/">Back home</Link>
      <ThemeToggle />
      </header>
      <main className="prose-page">
        <span className="eyebrow">CLEAR EXPECTATIONS</span>
        <h1>
          A tutor. A tool.
          <br />
          Your own thinking.
        </h1>
        <h2>Using your study desk</h2>
        <p>
          Use only assignments and reference material you have permission to
          upload. Do not include another person’s sensitive information
          unnecessarily.
        </p>
        <h2>Learning support</h2>
        <p>
          Scriblune provides AI learning assistance. It is not your instructor
          and cannot guarantee accuracy, grades, or compliance with a particular
          class policy. Check important reasoning and respect assessment rules.
          When outside help is explicitly restricted, use the tutor for concepts
          and analogous practice.
        </p>
        <h2>Supported materials</h2>
        <p>
          The app processes PDFs up to 30 pages and still PNG, JPEG, or WebP
          images up to 20 MB. Handwriting, diagrams, and scanned text can be
          misread. Other file formats, animations, audio assignments, and video
          are not supported.
        </p>
        <h2>Review and submission</h2>
        <p>
          Readiness checks use a rubric or provisional checklist you confirm.
          They are not official grades. “Submit assignment” saves an immutable
          final version inside Scriblune and finishes the session. It does not
          send work to a school, teacher, or learning-management system. Keep a
          separate copy of important work.
        </p>
        <h2>Community participation</h2>
        <p>
          Choose a username before posting in the public forum. Be respectful,
          avoid sharing personal information, and upload only content you have
          permission to share. Forum attachments support PNG, JPEG, WebP, and
          unencrypted PDFs up to 10 MB per file; profile pictures support still
          images up to 5 MB. Report content that needs moderator attention.
          Staff may edit or remove posts, close discussions, or suspend forum
          participation.
        </p>
        <h2>Plans, credits, and billing</h2>
        <p>
          Paid plans are monthly subscriptions in USD. The price and renewal
          amount are shown before you subscribe. Manage billing from the plans
          page to review a plan change, update payment details, or stop renewal.
          Cancellation keeps access through the paid period; afterward Free
          applies unless the Owner has granted a different plan.
        </p>
        <p>
          One tutor prompt uses one credit. Daily credits and new-session limits
          reset at midnight UTC and do not roll over. Bonus credits granted by
          the Owner carry over and are used after daily credits. Failed tutor
          requests are refunded. Stopping a response after it starts still uses
          a credit. Opening saved work and drawing do not spend credits. A new
          draft after submission counts as a new session. See the{" "}
          <Link href="/plans">plan comparison</Link> for current allowances.
        </p>
        <h2>Testing tools</h2>
        <p>
          Authorized testers can complete explicitly marked test sessions
          without a readiness review. A test completion is not a grading
          approval. Test ratings are labeled and kept separate from ordinary
          session feedback.
        </p>
        <h2>Availability and limitations</h2>
        <p>
          Private storage, background document processing, and AI services
          require operator configuration. Missing credentials produce setup
          messages. Network or provider failures may interrupt an explanation.
          Acknowledged saved work remains separate from transient streams.
        </p>
        <h2>Feedback and changes</h2>
        <p>
          Feedback is optional and does not change the completed review or block
          downloads. Staff review it privately under the{" "}
          <Link href="/privacy">privacy policy</Link>. Unreviewed feedback does
          not automatically retrain the AI.
        </p>
      </main>
    </>
  );
}
