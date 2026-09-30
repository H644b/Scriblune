# Dependencies and licensing

Direct versions are exact and the npm lockfile records transitive integrity hashes. Licenses below come from installed package metadata; preserve their LICENSE/NOTICE files when redistributing. Native libraries may have additional notices. No paid font or unlicensed external illustration is included.

| Package                      | Version | Declared license |
| ---------------------------- | ------- | ---------------- |
| @electric-sql/pglite         | 0.5.8   | Apache-2.0       |
| @fontsource-variable/dm-sans | 5.3.0   | OFL-1.1          |
| @fontsource/fraunces         | 5.3.0   | OFL-1.1          |
| @napi-rs/canvas              | 1.0.9   | MIT              |
| @playwright/test             | 1.63.0  | Apache-2.0       |
| @supabase/ssr                | 0.12.7  | MIT              |
| @supabase/supabase-js        | 2.117.2 | MIT              |
| @tanstack/react-query        | 5.104.0 | MIT              |
| @types/node                  | 24.19.0 | MIT              |
| @types/react                 | 19.3.0  | MIT              |
| @types/react-dom             | 19.3.0  | MIT              |
| katex                        | 0.18.9  | MIT              |
| lucide-react                 | 1.49.0  | ISC              |
| motion                       | 13.4.6  | MIT              |
| next                         | 16.3.7  | MIT              |
| openai                       | 7.25.0  | Apache-2.0       |
| pdf-lib                      | 1.17.1  | MIT              |
| pdfjs-dist                   | 6.3.289 | Apache-2.0       |
| postgres                     | 3.4.9   | Unlicense        |
| prettier                     | 3.9.9   | MIT              |
| react                        | 19.3.0  | MIT              |
| react-dom                    | 19.3.0  | MIT              |
| react-markdown               | 10.1.0  | MIT              |
| rehype-katex                 | 7.0.1   | MIT              |
| remark-gfm                   | 4.0.1   | MIT              |
| remark-math                  | 6.0.0   | MIT              |
| server-only                  | 0.0.1   | MIT              |
| sharp                        | 0.35.5  | Apache-2.0       |
| tsx                          | 4.23.15 | MIT              |
| typescript                   | 5.9.3   | Apache-2.0       |
| vitest                       | 4.1.11  | MIT              |
| zod                          | 4.6.5   | MIT              |
| zustand                      | 5.0.15  | MIT              |

DM Sans and Fraunces are bundled locally under the SIL Open Font License. Fixtures and Scriblune’s ink-stroke mark were authored for this project. Lucide icons carry their package license. Next.js, Supabase, OpenAI Responses/tool/vision documentation, and installed version-specific Next route/cookie/proxy guides were consulted during implementation.

Primary references:

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Supabase server-side auth](https://supabase.com/docs/guides/auth/server-side)
- [Supabase database roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [OpenAI Responses function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [GPT-5.4 model capabilities](https://developers.openai.com/api/docs/models/gpt-5.4)
- [PDF.js project](https://github.com/mozilla/pdf.js)

Deployment requires a Node runtime with TCP Postgres connectivity and native rendering libraries. The Cloudflare/Sites edge runtime is not an equivalent host for this worker architecture. The model adapter keeps API details separate from workspace primitives, but replacing the provider still requires implementing the streaming tool loop and evaluating behavior.
