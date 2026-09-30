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
      </header>
      <main className="prose-page">
        <span className="eyebrow">CLEAR EXPECTATIONS</span>
        <h1>
          A tutor. A tool.
          <br />
          Your own thinking.
        </h1>
        <h2>Who this pilot is for</h2>
        <p>
          The current pilot is for users aged 18 and older. Use only assignments
          and reference material you have permission to upload. Do not include
          another person’s sensitive information unnecessarily.
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
        <h2>Before a public launch</h2>
        <p>
          The operator must complete the documented launch review and provide
          final service terms, support contacts, and applicable privacy
          disclosures. This implementation does not assert legal, educational,
          or accessibility certification.
        </p>
      </main>
    </>
  );
}
