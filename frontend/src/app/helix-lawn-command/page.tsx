import type { Metadata } from "next";
import { HelixLawnCommandPage } from "@/components/helix-lawn-command-page";

export const metadata: Metadata = {
  title: "Helix Lawn Command | Blackspire Helix Group",
  description:
    "Helix Lawn Command turns lawn-care leads, missed calls, and intake automation into a branded operator system for service businesses.",
};

export default function HelixLawnCommandPublicPage() {
  return <HelixLawnCommandPage />;
}
