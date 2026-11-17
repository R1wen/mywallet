import {
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  ReceiptText,
  Settings,
  Store,
  Users,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sprint où l'écran arrive ; tant qu'il n'existe pas, l'entrée est désactivée. */
  sprint: number;
  mobile?: boolean;
};

/** Sprint en cours : les entrées des sprints suivants sont affichées désactivées. */
export const CURRENT_SPRINT = 5;

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard, sprint: 0, mobile: true },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, sprint: 1, mobile: true },
  { href: "/tickets", label: "Tickets", icon: ReceiptText, sprint: 3 },
  { href: "/magasins", label: "Magasins", icon: Store, sprint: 1 },
  { href: "/recurrent", label: "Récurrent", icon: CalendarClock, sprint: 2 },
  { href: "/personnes", label: "Personnes", icon: Users, sprint: 4, mobile: true },
  { href: "/budgets", label: "Budgets", icon: PiggyBank, sprint: 5 },
  { href: "/analyses", label: "Analyses", icon: BarChart3, sprint: 6 },
  { href: "/reglages", label: "Réglages", icon: Settings, sprint: 1, mobile: true },
];

export function isAvailable(item: NavItem): boolean {
  return item.sprint <= CURRENT_SPRINT;
}

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
