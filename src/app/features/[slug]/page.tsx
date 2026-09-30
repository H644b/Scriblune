import { notFound } from "next/navigation";
import Link from "next/link";
import { features } from "@/lib/features";
import { Logo, Mark } from "@/components/brand";
import { StartButton } from "@/components/marketing-client";
export function generateStaticParams() {
  return features.map((f) => ({ slug: f.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const f = features.find((f) => f.slug === slug);
  return f
    ? {
        title: f.name,
        description: f.lead,
        alternates: { canonical: `/features/${f.slug}` },
      }
    : {};
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params,
    f = features.find((f) => f.slug === slug);
  if (!f) notFound();
  return (
    <>
      <header className="desk-header">
        <Logo />
        <Link href="/demo">Explore the workspace</Link>
      </header>
      <main className="feature-page">
        <span className="eyebrow">{f.eyebrow}</span>
        <h1>
          {f.headline.split("\n").map((line, i) => (
            <span key={line}>
              {i > 0 && <br />}
              {line}
            </span>
          ))}
        </h1>
        <p className="feature-lead">{f.lead}</p>
        <div className="feature-example">
          <Mark size={33} />
          <div>
            <span className="eyebrow">
              AN EXAMPLE, NOT A PROMISE OF ACCURACY
            </span>
            <p>{f.example}</p>
          </div>
        </div>
        {f.sections.map(([title, body]) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
          </section>
        ))}
        <div className="feature-cta">
          <StartButton />
          <Link className="button secondary" href="/demo">
            Explore with a sample page
          </Link>
        </div>
        <nav aria-label="More workspace features" className="feature-nav">
          {features
            .filter((x) => x.slug !== slug)
            .map((x) => (
              <Link key={x.slug} href={`/features/${x.slug}`}>
                {x.name}
              </Link>
            ))}
        </nav>
      </main>
    </>
  );
}
