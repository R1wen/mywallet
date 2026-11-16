"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCommandPalette } from "./command-palette";

export function OpenPaletteButton({
  label = "Ouvrir la palette de commandes",
}: {
  label?: string;
}) {
  const palette = useCommandPalette();
  return (
    <Button size="sm" onClick={palette.open}>
      <Search /> {label}
    </Button>
  );
}
