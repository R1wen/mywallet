// Mode privé (ADR-044) : appliqué avant l'affichage pour ne jamais montrer un montant.
try {
  if (localStorage.getItem("mw.private") === "1") document.documentElement.dataset.private = "";
} catch {}
