import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BookOpen,
  Boxes,
  Check,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Package,
  Plus,
  Receipt,
  Search,
  Sun,
  Truck,
  ArrowLeftRight,
  Warehouse,
  User as UserIcon,
  ChevronDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentOrg } from "@/hooks/useOrg";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

function initialsFromEmail(email: string | null | undefined) {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

// Two visual groups, matching the reference layout: everyday views up top,
// action/ops items (what needs doing) below a divider.
const NAV_PRIMARY = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/products", label: "Products", icon: Package },
  { to: "/inventory", label: "Inventory", icon: ArrowLeftRight },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
] as const;

const NAV_SECONDARY = [
  { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { to: "/alerts", label: "Alerts", icon: AlertTriangle },
  { to: "/gst-filing", label: "GST Filing", icon: Receipt },
] as const;

export function AppShell({
  title,
  description,
  actions,
  showBackButton,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Show a "Back" control before the title, for pages reached by drilling
   * in rather than from the primary sidebar (e.g. Account/Profile). */
  showBackButton?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const { org, memberships, selectOrg, loading, role } = useCurrentOrg();
  const { mode, setMode } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && memberships.length === 0) navigate({ to: "/onboarding" });
  }, [loading, memberships.length, navigate]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const openAlerts = useQuery({
    queryKey: ["open-alerts-count", org?.id],
    enabled: !!org?.id,
    queryFn: async () => {
      const { count } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", org!.id)
        .eq("status", "open");
      return count ?? 0;
    },
  });
  const openAlertCount = openAlerts.data ?? 0;

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const navItem = (
    item: (typeof NAV_PRIMARY)[number] | (typeof NAV_SECONDARY)[number],
    onNavigate?: () => void,
  ) => {
    const Icon = item.icon;
    const active = pathname === item.to;
    const showAlertDot = item.to === "/alerts" && openAlertCount > 0;
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-signal text-signal-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <span className="relative flex">
          <Icon className="size-4" />
          {showAlertDot ? (
            <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-destructive" />
          ) : null}
        </span>
        {item.label}
      </Link>
    );
  };

  const navLinks = (onNavigate?: () => void) => (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV_PRIMARY.map((item) => navItem(item, onNavigate))}
      <div className="my-2 border-t border-sidebar-border" />
      {NAV_SECONDARY.map((item) => navItem(item, onNavigate))}
    </nav>
  );

  const ThemeIcon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const themeLabel = mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System";

  const sidebarBody = (onNavigate?: () => void) => (
    <>
      {navLinks(onNavigate)}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="mt-4 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ThemeIcon className="size-4" />
            {themeLabel}
            <ChevronDown className="ml-auto size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top">
          {(
            [
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
              { value: "system", label: "System", icon: Monitor },
            ] satisfies { value: ThemeMode; label: string; icon: typeof Sun }[]
          ).map((opt) => (
            <DropdownMenuItem key={opt.value} onClick={() => setMode(opt.value)}>
              <opt.icon className="size-4" />
              {opt.label}
              {mode === opt.value ? <Check className="ml-auto size-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="size-5" />
          <span className="sr-only">Open navigation</span>
        </Button>

        <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-signal/15">
            <Boxes className="size-5 text-signal" />
          </span>
          <span className="hidden font-display text-lg font-bold tracking-tight sm:inline">
            StockPilot
          </span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {memberships.length > 0 ? (
            <Select
              value={org?.id ?? ""}
              onValueChange={(value) => {
                if (value === "__new_business__") {
                  navigate({ to: "/onboarding" });
                  return;
                }
                selectOrg(value);
              }}
            >
              <SelectTrigger className="w-40 shrink-0 sm:w-48">
                <SelectValue placeholder="Business" />
              </SelectTrigger>
              <SelectContent>
                {memberships.map((m) => (
                  <SelectItem key={m.organizations.id} value={m.organizations.id}>
                    {m.organizations.name}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value="__new_business__">
                  <span className="flex items-center gap-2">
                    <Plus className="size-4" />
                    Create new business
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : null}

          <div className="relative hidden lg:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search…"
              className="h-9 w-56 rounded-md border border-input bg-secondary/40 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <button
            onClick={() => navigate({ to: "/alerts" })}
            className="relative shrink-0 rounded-full p-2 text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="size-5" />
            <span className="sr-only">Alerts</span>
            {openAlertCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                {openAlertCount > 9 ? "9+" : openAlertCount}
              </span>
            ) : null}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="shrink-0 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                    {initialsFromEmail(user?.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                {user?.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate({ to: "/account" })}>
                <UserIcon className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: "/blog" })}>
                <BookOpen className="size-4" />
                Blog
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 md:flex">
          {sidebarBody()}
        </aside>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="flex w-64 flex-col bg-sidebar p-4">
            <SheetTitle asChild>
              <Link
                to="/dashboard"
                onClick={() => setMobileNavOpen(false)}
                className="mb-6 flex items-center gap-2 px-2"
              >
                <Boxes className="size-5 text-signal" />
                <span className="font-display text-lg font-bold tracking-tight">StockPilot</span>
              </Link>
            </SheetTitle>

            {sidebarBody(() => setMobileNavOpen(false))}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-4 backdrop-blur md:px-8">
            {showBackButton ? (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => window.history.back()}
              >
                <ArrowLeft className="size-4" />
                <span className="sr-only">Back</span>
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-bold tracking-tight">{title}</h1>
              {description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {role ? (
              <span className="hidden shrink-0 rounded-full border border-border px-3 py-1 text-xs capitalize text-muted-foreground sm:inline">
                {role}
              </span>
            ) : null}
            {actions}
          </div>

          <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
