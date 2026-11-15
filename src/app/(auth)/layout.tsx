export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2 text-md font-semibold">
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-[5px] bg-accent"
        >
          <span className="h-2.5 w-3 rounded-[1px] border-[1.5px] border-bg" />
        </span>
        myWallet
      </div>
      <div className="w-full max-w-sm rounded-md border border-border bg-surface">{children}</div>
    </main>
  );
}
