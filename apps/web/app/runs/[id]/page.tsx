import type { Metadata } from "next";
import { RunView } from "@/components/run/run-view";
import { prisma } from "@/lib/server/services";

/** A shared link previews as the prompt and the models, not a generic app title. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const run = await prisma.comparison
    .findUnique({ where: { id }, select: { prompt: true, models: true } })
    .catch(() => null);
  if (!run) return { title: "Compare run · Model FOMO" };
  const prompt = run.prompt.replace(/\s+/g, " ").trim();
  const title = `${prompt.length > 70 ? `${prompt.slice(0, 69)}…` : prompt} · Model FOMO`;
  const description = `${run.models.length} models compared side by side on DigitalOcean: ${run.models.slice(0, 6).join(", ")}${run.models.length > 6 ? ", …" : ""}.`;
  return { title, description, openGraph: { title, description, type: "article" }, twitter: { card: "summary", title, description } };
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunView id={id} />;
}
