import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { OpenPaletteButton } from "@/components/shell/open-palette-button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Tableau de bord" />
      <Card>
        <EmptyState
          icon={LayoutDashboard}
          title="Le tableau de bord du mois arrive au sprint 1."
          description="En attendant, la palette de commandes donne accès à toutes les pages."
          action={<OpenPaletteButton />}
        />
      </Card>
    </>
  );
}
