import type { MetadataRoute } from "next";

/** Installable app (ADR-045): standalone, dark, shortcuts to the frequent actions. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "myWallet",
    short_name: "myWallet",
    description: "Suivi de dépenses, tickets et créances.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0C0D0F",
    theme_color: "#0C0D0F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Ajouter un ticket", short_name: "Ticket", url: "/tickets" },
      { name: "Transactions", url: "/transactions" },
      { name: "Analyses", url: "/analyses" },
    ],
  };
}
