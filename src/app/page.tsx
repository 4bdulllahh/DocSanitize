import { HomeIntro } from "@/components/tools/HomeIntro";
import { ToolDirectory } from "@/components/tools/ToolDirectory";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 lg:px-8">
      <HomeIntro />
      <ToolDirectory />
    </div>
  );
}
