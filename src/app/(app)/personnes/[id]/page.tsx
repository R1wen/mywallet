import { ChevronLeft, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  CancelPaymentButton,
  ClaimActionButton,
  EditShareButton,
  PersonAdminButtons,
  ReminderButton,
} from "@/components/people/claim-actions";
import { PaymentButton, type OpenClaimLine } from "@/components/people/payment-dialog";
import { PersonDialog } from "@/components/people/person-dialog";
import { Amount } from "@/components/ui/amount";
import { Badge, ClaimBadge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MerchantLogo } from "@/components/ui/merchant-logo";
import { merchantLogoProps } from "@/components/ui/merchant-logo-props";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { formatDateFr, toParisDateString } from "@/lib/domain/dates";
import { listAccounts } from "@/lib/server/accounts";
import { getPersonDetail, type PersonClaim, type PersonExpense } from "@/lib/server/sharing";
import { cn } from "@/lib/utils";
import { idSchema } from "@/lib/validation/settings";

export default function PersonPage({ params }: PageProps<"/personnes/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <PersonDetail params={params} />
    </Suspense>
  );
}

const claimLabel = (c: PersonClaim) => c.itemLabel ?? "Part de la dépense";

function ClaimRow({
  claim,
  expense,
  personId,
  personName,
  accounts,
  today,
}: {
  claim: PersonClaim;
  expense: PersonExpense;
  personId: string;
  personName: string;
  accounts: { id: string; name: string }[];
  today: string;
}) {
  const context = `${claimLabel(claim)}, ${expense.label} du ${formatDateFr(expense.occurredOn)}`;
  const partial = claim.status === "pending" && claim.paidCents > 0;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 sm:min-h-11 sm:flex-nowrap sm:py-1 sm:pl-11">
      <span className="flex min-w-0 basis-full flex-col sm:flex-1 sm:basis-auto">
        <span className="truncate text-base">{claimLabel(claim)}</span>
        {(partial || claim.resolvedAt) && (
          <span className="text-xs text-muted">
            {partial ? (
              <>
                Reste <Amount cents={claim.remainingCents} className="text-muted" /> sur{" "}
                <Amount cents={claim.amountCents} className="text-muted" />
              </>
            ) : claim.resolvedAt ? (
              `Le ${formatDateFr(claim.resolvedAt)}`
            ) : null}
          </span>
        )}
      </span>
      <ClaimBadge status={claim.status} />
      <Amount
        cents={claim.status === "pending" ? claim.remainingCents : claim.amountCents}
        className={cn(
          "ml-auto text-right sm:ml-0 sm:w-24",
          claim.status === "cancelled" && "text-muted line-through",
        )}
      />
      <span className="flex w-full justify-end gap-1 sm:w-72 sm:shrink-0">
        {claim.status === "pending" && (
          <>
            <PaymentButton
              personId={personId}
              personName={personName}
              claims={[
                {
                  claimId: claim.id,
                  label: expense.label,
                  detail: claim.itemLabel,
                  date: expense.occurredOn,
                  remainingCents: claim.remainingCents,
                },
              ]}
              accounts={accounts}
              today={today}
              label="Rembourser"
              variant="ghost"
            />
            <ClaimActionButton
              claimId={claim.id}
              action="gift"
              label="Offrir"
              description={`Offrir : ${context}`}
            />
            {claim.paidCents === 0 && (
              <ClaimActionButton
                claimId={claim.id}
                action="cancel"
                label="Annuler la part"
                description={`Annuler la créance : ${context}`}
              />
            )}
          </>
        )}
        {(claim.status === "gifted" || claim.status === "cancelled") && (
          <ClaimActionButton
            claimId={claim.id}
            action="reopen"
            label="Rouvrir"
            description={`Rouvrir : ${context}`}
          />
        )}
      </span>
    </li>
  );
}

async function PersonDetail({ params }: Pick<PageProps<"/personnes/[id]">, "params">) {
  const user = await requireUser();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const [detail, accounts] = await Promise.all([
    getPersonDetail(user.id, id.data),
    listAccounts(user.id),
  ]);
  if (!detail) notFound();
  const { person, totals, expenses, payments } = detail;
  const today = toParisDateString(new Date());
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));

  // Oldest first: a global payment settles the oldest debts first (ADR-033).
  const open: OpenClaimLine[] = [...expenses].reverse().flatMap((e) =>
    e.claims
      .filter((c) => c.remainingCents > 0)
      .map((c) => ({
        claimId: c.id,
        label: e.label,
        detail: c.itemLabel,
        date: e.occurredOn,
        remainingCents: c.remainingCents,
      })),
  );
  const reminder = [...expenses]
    .reverse()
    .map((e) => ({
      date: e.occurredOn,
      label: e.label,
      lines: e.claims
        .filter((c) => c.remainingCents > 0)
        .map((c) => ({ label: c.itemLabel, remainingCents: c.remainingCents })),
    }))
    .filter((g) => g.lines.length);
  const claimLabels = new Map(
    expenses.flatMap((e) => e.claims.map((c) => [c.id, `${e.label} · ${claimLabel(c)}`] as const)),
  );

  return (
    <>
      <Link
        href="/personnes"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text pointer-coarse:min-h-11"
      >
        <ChevronLeft className="size-4" aria-hidden /> Personnes
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <MerchantLogo name={person.name} size={48} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
              <span className="truncate">{person.name}</span>
              {person.archived && <Badge tone="muted">Archivée</Badge>}
            </h1>
            {person.notes && <p className="truncate text-base text-muted">{person.notes}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open.length > 0 && <ReminderButton personName={person.name} groups={reminder} />}
          {open.length > 0 && (
            <PaymentButton
              personId={person.id}
              personName={person.name}
              claims={open}
              accounts={accountOptions}
              today={today}
            />
          )}
        </div>
      </div>

      <Card className="mb-6 grid grid-cols-1 divide-border max-sm:divide-y sm:grid-cols-3 sm:divide-x">
        {(
          [
            ["pending", totals.pendingCents],
            ["reimbursed", totals.reimbursedCents],
            ["gifted", totals.giftedCents],
          ] as const
        ).map(([status, cents]) => (
          <div key={status} className="flex flex-col gap-1.5 px-4 py-3">
            <ClaimBadge status={status} className="self-start" />
            <Amount cents={cents} className="text-lg font-medium" />
          </div>
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Dépenses partagées</CardTitle>
          </CardHeader>
          {expenses.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="Aucune dépense partagée avec cette personne."
              description="Partagez un ticket à sa validation ou une dépense depuis sa fiche."
            />
          ) : (
            <ul role="list" className="divide-y divide-border">
              {expenses.map((e) => (
                <li key={e.transactionId} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {e.merchantId && e.merchantLogo && e.merchantName ? (
                      <MerchantLogo
                        {...merchantLogoProps({
                          id: e.merchantId,
                          name: e.merchantName,
                          ...e.merchantLogo,
                        })}
                      />
                    ) : (
                      <MerchantLogo name={e.label} />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base font-medium">{e.label}</span>
                      <span className="text-xs text-muted">
                        {formatDateFr(e.occurredOn)} · ticket de{" "}
                        <Amount cents={e.totalCents} className="text-muted" />
                      </span>
                    </span>
                    <EditShareButton transactionId={e.transactionId} label={e.label} />
                  </div>
                  <ul role="list" className="mt-1">
                    {e.claims.map((c) => (
                      <ClaimRow
                        key={c.id}
                        claim={c}
                        expense={e}
                        personId={person.id}
                        personName={person.name}
                        accounts={accountOptions}
                        today={today}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Remboursements reçus</CardTitle>
            </CardHeader>
            {payments.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">
                Aucun remboursement pour l&apos;instant.
              </p>
            ) : (
              <ul role="list" className="divide-y divide-border">
                {payments.map((p) => (
                  <li key={p.transactionId} className="flex flex-col gap-1 px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-base">{formatDateFr(p.occurredOn)}</span>
                        <span className="truncate text-xs text-muted">{p.accountName}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Amount cents={p.amountCents} variant="flow" />
                        <CancelPaymentButton
                          transactionId={p.transactionId}
                          label={`remboursement du ${formatDateFr(p.occurredOn)}`}
                        />
                      </span>
                    </div>
                    {p.parts.length > 1 && (
                      <ul role="list" className="text-xs text-muted">
                        {p.parts.map((part) => (
                          <li key={part.claimId} className="flex justify-between gap-3">
                            <span className="truncate">{claimLabels.get(part.claimId)}</span>
                            <Amount cents={part.amountCents} className="text-muted" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Personne</CardTitle>
            </CardHeader>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              <PersonDialog person={person} />
              <PersonAdminButtons
                personId={person.id}
                archived={person.archived}
                hasHistory={expenses.length > 0}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
