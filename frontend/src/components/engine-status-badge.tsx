export function EngineStatusBadge({ status }: { status: "live" | "building" }) {
  return (
    <span className="project-pill">
      {status === "live" ? "live surface" : "building"}
    </span>
  );
}
