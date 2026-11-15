"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth/client";

/** Déconnexion : invalide la session côté serveur puis renvoie vers /connexion. */
export function useSignOut() {
  const router = useRouter();
  return useCallback(async () => {
    const { error } = await authClient.signOut();
    if (error) {
      toast.error("La déconnexion a échoué. Réessayez.");
      return;
    }
    router.replace("/connexion");
    router.refresh();
  }, [router]);
}
