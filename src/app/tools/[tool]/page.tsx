import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolView } from "@/components/tools/ToolView";
import { getTool, TOOLS } from "@/lib/tools";

// Every tool page is pre-rendered at build time; unknown slugs 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ tool: tool.id }));
}

export async function generateMetadata({ params }: PageProps<"/tools/[tool]">): Promise<Metadata> {
  const { tool: id } = await params;
  const tool = getTool(id);
  return tool ? { title: tool.name, description: tool.description } : {};
}

export default async function ToolPage({ params }: PageProps<"/tools/[tool]">) {
  const { tool: id } = await params;
  if (!getTool(id)) notFound();
  // Pass the id rather than the Tool object: its icon component can't cross the server/client boundary.
  return <ToolView toolId={id} />;
}
