import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account · Oracle Helix" },
      { name: "description", content: "Create your Oracle Helix sports intelligence terminal." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
