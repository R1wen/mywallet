import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
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
          description="Comptes, transactions et magasins seront disponibles ici."
        />
      </Card>
    </>
  );
}
