import { LogoMark } from "@/components/ui/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2 text-md font-semibold">
        <LogoMark size={24} />
        myWallet
      </div>
      <div className="w-full max-w-sm rounded-md border border-border bg-surface">{children}</div>
    </main>
  );
}
