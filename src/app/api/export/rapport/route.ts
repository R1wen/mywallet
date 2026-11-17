import { getCurrentUser } from "@/lib/auth/session";
import { formatMonthKey, parseMonthKey, shiftMonth, toParisDateString } from "@/lib/domain/dates";
import { buildReportPdf } from "@/lib/export/pdf";
import { getMonthlyReport } from "@/lib/server/analytics";

/** Monthly report as a PDF (ADR-041, 042); the past month by default. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const today = toParisDateString(new Date());
  const month =
    parseMonthKey(new URL(req.url).searchParams.get("mois")) ??
    shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1);
  const report = await getMonthlyReport(user.id, month, today);
  const elided = /^[aeiouyéè]/i.test(report.monthLabel) ? "d'" : "de ";
  const pdf = await buildReportPdf({
    title: `Rapport ${elided}${report.monthLabel}`,
    subtitle: "myWallet · calculé à partir de vos mouvements, sur ma dépense réelle.",
    sections: report.sections,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="mywallet-rapport-${formatMonthKey(month)}.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
