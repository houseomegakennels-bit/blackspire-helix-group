import { EngineCard } from "@/components/engine-card";
import type { RealEstateEngineConfig } from "@/lib/real-estate-intelligence";

export function PipelineFlow({ engines }: { engines: RealEstateEngineConfig[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-4">
      {engines.map((engine) => (
        <EngineCard key={engine.id} engine={engine} />
      ))}
    </div>
  );
}
