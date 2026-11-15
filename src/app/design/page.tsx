import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/shell/app-shell";
import { DesignShowcase } from "./showcase";

export const metadata: Metadata = { title: "Design system" };

/** Page réservée au développement : 404 en production. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DESIGN_PAGE !== "1") {
    notFound();
  }
  return (
    <AppShell>
      <PageHeader
        title="Design system"
        description="Charte Graphite : tokens, typographie et composants de base. Page de développement."
      />
      <DesignShowcase />
    </AppShell>
  );
}
