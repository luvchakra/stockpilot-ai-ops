import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/warehouses")({
  head: () => ({
    meta: [
      { title: "Warehouses — StockPilot" },
      { name: "description", content: "Manage warehouses, stores and distribution centers." },
    ],
  }),
  component: Warehouses,
});

const emptyForm = { name: "", code: "", type: "warehouse", city: "", state: "", address: "" };

function Warehouses() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const warehouses = useQuery({
    queryKey: ["warehouses", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createWarehouse = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("warehouses").insert({
        org_id: orgId!,
        name: form.name,
        code: form.code,
        type: form.type,
        city: form.city || null,
        state: form.state || null,
        address: form.address || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Warehouse created");
      setOpen(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["warehouses", orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create warehouse"),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("warehouses").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["warehouses", orgId] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update warehouse"),
  });

  return (
    <AppShell
      title="Warehouses"
      description="Warehouses, stores and distribution centers."
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              New warehouse
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New warehouse</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createWarehouse.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wh-name">Name</Label>
                  <Input
                    id="wh-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Mumbai Warehouse"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wh-code">Code</Label>
                  <Input
                    id="wh-code"
                    required
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="WH-MUM"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wh-city">City</Label>
                  <Input
                    id="wh-city"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wh-state">State</Label>
                  <Input
                    id="wh-state"
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wh-address">Address</Label>
                <Input
                  id="wh-address"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createWarehouse.isPending}>
                  {createWarehouse.isPending ? "Creating…" : "Create warehouse"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      {warehouses.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !warehouses.data || warehouses.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <WarehouseIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No warehouses yet. Create your first one.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.data.map((wh) => (
                <TableRow key={wh.id}>
                  <TableCell className="font-medium">{wh.name}</TableCell>
                  <TableCell>{wh.code}</TableCell>
                  <TableCell>{wh.city ?? "—"}</TableCell>
                  <TableCell>{wh.state ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={wh.is_active ? "default" : "secondary"}>
                      {wh.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive.mutate({ id: wh.id, is_active: !wh.is_active })}
                    >
                      {wh.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
