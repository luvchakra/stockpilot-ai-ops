import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Loader2, Sparkles, Trash2 } from "lucide-react";
import { isPlatformAdmin } from "@/lib/admin-auth";
import {
  adminDeleteSeedData,
  adminListOrgsForUser,
  adminListSeedBatches,
  adminListUsers,
  adminSeedDemoData,
} from "@/lib/admin-seed-actions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { isAdmin } = await isPlatformAdmin();
    if (!isAdmin) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Admin — StockPilot" },
      { name: "description", content: "Seed or clear demo data for a business." },
    ],
  }),
  component: AdminSeedDataPage,
});

function AdminSeedDataPage() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => adminListUsers(),
  });

  const orgs = useQuery({
    queryKey: ["admin", "orgs", userId],
    enabled: !!userId,
    queryFn: () => adminListOrgsForUser({ data: { userId: userId! } }),
  });

  const batches = useQuery({
    queryKey: ["admin", "seed-batches", orgId],
    enabled: !!orgId,
    queryFn: () => adminListSeedBatches({ data: { orgId: orgId! } }),
  });

  const seed = useMutation({
    mutationFn: () => adminSeedDemoData({ data: { orgId: orgId!, targetUserId: userId! } }),
    onSuccess: (result) => {
      toast.success(`Seeded ${result.recordCount} demo records into ${result.orgName}`);
      queryClient.invalidateQueries({ queryKey: ["admin", "seed-batches", orgId] });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to seed demo data"),
  });

  const del = useMutation({
    mutationFn: () => adminDeleteSeedData({ data: { orgId: orgId! } }),
    onSuccess: (result) => {
      toast.success(
        result.deletedBatches
          ? `Deleted ${result.deletedRecords} demo records across ${result.deletedBatches} batch(es)`
          : "No demo data to delete for this business",
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "seed-batches", orgId] });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete demo data"),
  });

  const selectedOrg = orgs.data?.find((o) => o.id === orgId);
  const hasBatches = (batches.data?.length ?? 0) > 0;

  return (
    <AppShell
      title="Demo data"
      description="Seed or clear a realistic demo dataset for any business, on behalf of any user."
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="panel flex flex-col gap-4 p-5">
          <div>
            <p className="text-sm font-medium">1. User</p>
            <p className="text-sm text-muted-foreground">
              Pick the user whose businesses you want to browse.
            </p>
          </div>
          {users.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={userId ?? ""}
              onValueChange={(value) => {
                setUserId(value);
                setOrgId(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a user" />
              </SelectTrigger>
              <SelectContent>
                {(users.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name ? `${u.full_name} — ${u.email}` : (u.email ?? u.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {userId ? (
          <div className="panel flex flex-col gap-4 p-5">
            <div>
              <p className="text-sm font-medium">2. Business</p>
              <p className="text-sm text-muted-foreground">Every business this user belongs to.</p>
            </div>
            {orgs.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : orgs.data?.length ? (
              <Select value={orgId ?? ""} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a business" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.data.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name} ({o.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                This user doesn't belong to any business yet.
              </p>
            )}
          </div>
        ) : null}

        {orgId ? (
          <div className="panel flex flex-col gap-5 p-5">
            <div>
              <p className="text-sm font-medium">3. Seed or clear demo data</p>
              <p className="text-sm text-muted-foreground">
                Populates categories, warehouses, suppliers, customers, products, purchase and sales
                orders (across every status), invoices, credit/debit notes, stock transfers and
                low-stock alerts for <span className="font-medium">{selectedOrg?.name}</span>. Every
                row this creates is tracked, so it can be removed again without touching any real
                data.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
                {seed.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Seed demo data
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={!hasBatches || del.isPending}>
                    {del.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Delete demo data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete all demo data for {selectedOrg?.name}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes every record ever seeded by this tool for this business — across
                      all {batches.data?.length ?? 0} seed run(s) — and cannot be undone. It never
                      touches data the business's own users created.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => del.mutate()}
                    >
                      Delete demo data
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Database className="size-4" /> Seed history
              </p>
              {batches.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : hasBatches ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Seeded</TableHead>
                      <TableHead>For user</TableHead>
                      <TableHead>By admin</TableHead>
                      <TableHead className="text-right">Records</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.data!.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>{formatDateTime(b.created_at)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.targetUserEmail ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.requestedByEmail ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">{b.record_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No demo data has been seeded for this business yet.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
