import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { SourceModeHarness } from "./source-mode-harness";

export const metadata: Metadata = { title: "Source mode" };

const corpus = join(process.cwd(), "lib", "rich-text", "corpus", "gfm");

/** Source mode on its own, loaded with an empty note or a document from the round-trip corpus. */
export default async function SourceModeDevPage({ searchParams }: PageProps<"/dev/source-mode">) {
  const fixtures = (await readdir(corpus)).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
  const { fixture } = await searchParams;
  const chosen = typeof fixture === "string" && fixtures.includes(fixture) ? fixture : null;
  const markdown = chosen ? await readFile(join(corpus, `${chosen}.md`), "utf8") : "";

  return <SourceModeHarness key={chosen ?? ""} fixtures={fixtures} fixture={chosen} initialMarkdown={markdown} />;
}
