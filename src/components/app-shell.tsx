import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Boxes,
  LayoutDashboard,
  Package,
  Warehouse,
  Truck,
  Bell,
  ArrowLeftRight,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentOrg } from "@/hooks/useOrg";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function initialsFromEmail(email: string | null | undefined) {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/products", label: "Products", icon: Package },
  { to: "/inventory", label: "Inventory", icon: ArrowLeftRight },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/alerts", label: "Alerts", icon: Bell },
] as const;

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const { org, memberships, selectOrg, loading, role } = useCurrentOrg();

  useEffect(() => {
    if (!loading && memberships.length === 0) navigate({ to: "/onboarding" });
  }, [loading, memberships.length, navigate]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link to="/dashboard" className="mb-6 flex items-center gap-2 px-2">
          <Boxes className="size-5 text-signal" />
          <span className="font-display text-lg font-bold tracking-tight">StockPilot</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-4 md:px-8">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-bold tracking-tight">{title}</h1>
              {description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              {memberships.length > 0 ? (
                <Select value={org?.id ?? ""} onValueChange={selectOrg}>
                  <SelectTrigger className="w-48 shrink-0">
                    <SelectValue placeholder="Workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {memberships.map((m) => (
                      <SelectItem key={m.organizations.id} value={m.organizations.id}>
                        {m.organizations.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {role ? (
                <span className="hidden shrink-0 rounded-full border border-border px-3 py-1 text-xs capitalize text-muted-foreground sm:inline">
                  {role}
                </span>
              ) : null}
              {actions}
            </div>
            {/* Always pinned to the top-right corner, independent of how much
                else is in the header — never wraps or scrolls away. */}
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
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-2 py-2 md:hidden">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium",
                  pathname === item.to
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
