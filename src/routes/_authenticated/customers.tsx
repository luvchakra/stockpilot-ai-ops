import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDIAN_STATES, isValidGstin } from "@/lib/gst";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — StockPilot" },
      { name: "description", content: "Manage customers for sales orders and invoicing." },
    ],
  }),
  component: Customers,
});

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];

const emptyForm = {
  name: "",
  gstin: "",
  phone: "",
  email: "",
  billing_address: "",
  shipping_address: "",
  state: "",
};

function Customers() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ["customers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const saveCustomer = useMutation({
    mutationFn: async () => {
      const gstin = form.gstin.trim().toUpperCase();
      if (gstin && !isValidGstin(gstin)) {
        throw new Error("That GSTIN doesn't look valid — check the 15 characters and try again.");
      }
      const payload = {
        name: form.name,
        gstin: gstin || null,
        phone: form.phone || null,
        email: form.email || null,
        billing_address: form.billing_address || null,
        shipping_address: form.shipping_address || null,
        state: form.state || null,
      };
      if (editingId) {
        const { error } = await supabase.from("customers").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert({ org_id: orgId!, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Customer updated" : "Customer created");
      setOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["customers", orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save customer"),
  });

  const startEdit = (cust: NonNullable<typeof customers.data>[number]) => {
    setForm({
      name: cust.name,
      gstin: cust.gstin ?? "",
      phone: cust.phone ?? "",
      email: cust.email ?? "",
      billing_address: cust.billing_address ?? "",
      shipping_address: cust.shipping_address ?? "",
      state: cust.state ?? "",
    });
    setEditingId(cust.id);
    setOpen(true);
  };

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("customers").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers", orgId] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update customer"),
  });

  return (
    <AppShell
      title="Customers"
      description="Buyers for sales orders and invoicing."
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              onClick={() => {
                setForm(emptyForm);
                setEditingId(null);
              }}
            >
              <Plus className="size-4" />
              New customer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit customer" : "New customer"}</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveCustomer.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cust-name">Name</Label>
                  <Input
                    id="cust-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Retail Buyer Pvt Ltd"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-phone">Phone</Label>
                  <Input
                    id="cust-phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-email">Email</Label>
                  <Input
                    id="cust-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-gst">GSTIN</Label>
                  <Input
                    id="cust-gst"
                    value={form.gstin}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))
                    }
                    placeholder="22AAAAA0000A1Z5"
                    maxLength={15}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-state">State (for GST place of supply)</Label>
                  <Select
                    value={form.state}
                    onValueChange={(v) => setForm((f) => ({ ...f, state: v }))}
                  >
                    <SelectTrigger id="cust-state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.name}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-billing">Billing address</Label>
                  <Input
                    id="cust-billing"
                    value={form.billing_address}
                    onChange={(e) => setForm((f) => ({ ...f, billing_address: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-shipping">Shipping address</Label>
                  <Input
                    id="cust-shipping"
                    value={form.shipping_address}
                    onChange={(e) => setForm((f) => ({ ...f, shipping_address: e.target.value }))}
                    placeholder="Same as billing if left blank"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saveCustomer.isPending}>
                  {saveCustomer.isPending
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : "Create customer"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      {customers.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !customers.data || customers.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <Users className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No customers yet. Add your first one.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.data.map((cust: CustomerRow) => (
                  <TableRow key={cust.id}>
                    <TableCell className="font-medium">{cust.name}</TableCell>
                    <TableCell>{cust.phone ?? "—"}</TableCell>
                    <TableCell>{cust.email ?? "—"}</TableCell>
                    <TableCell>{cust.state ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{cust.gstin ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={cust.is_active ? "default" : "secondary"}>
                        {cust.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(cust)}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleActive.mutate({ id: cust.id, is_active: !cust.is_active })
                        }
                      >
                        {cust.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 sm:hidden">
            {customers.data.map((cust: CustomerRow) => (
              <div key={cust.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{cust.name}</p>
                    <p className="text-xs text-muted-foreground">{cust.email ?? "—"}</p>
                  </div>
                  <Badge variant={cust.is_active ? "default" : "secondary"} className="shrink-0">
                    {cust.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="truncate">{cust.phone ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">State</p>
                    <p className="truncate">{cust.state ?? "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">GSTIN</p>
                    <p className="truncate font-mono text-xs">{cust.gstin ?? "—"}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(cust)}>
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive.mutate({ id: cust.id, is_active: !cust.is_active })}
                  >
                    {cust.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
