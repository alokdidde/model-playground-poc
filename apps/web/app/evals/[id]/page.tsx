import { EvalRunDetail } from "@/components/evals/eval-run-detail";

export default async function EvalRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EvalRunDetail id={id} />;
}
