import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Star, Truck } from "lucide-react";
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
import { usePermissions } from "@/hooks/usePermissions";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers — StockPilot" },
      { name: "description", content: "Manage suppliers and procurement contacts." },
    ],
  }),
  component: Suppliers,
});

const emptyForm = {
  name: "",
  code: "",
  contact_person: "",
  email: "",
  phone: "",
  gst_number: "",
  address: "",
  city: "",
  state: "",
  payment_terms: "",
  lead_time_days: "7",
  min_order_quantity: "",
  rating: "0",
};

function Suppliers() {
  const { org } = useCurrentOrg();
  const { can } = usePermissions();
  const canEdit = can("suppliers.edit");
  const orgId = org?.id;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const suppliers = useQuery({
    queryKey: ["suppliers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const saveSupplier = useMutation({
    mutationFn: async () => {
      const gstin = form.gst_number.trim().toUpperCase();
      if (gstin && !isValidGstin(gstin)) {
        throw new Error("That GSTIN doesn't look valid — check the 15 characters and try again.");
      }
      const payload = {
        name: form.name,
        code: form.code || null,
        contact_person: form.contact_person || null,
        email: form.email || null,
        phone: form.phone || null,
        gst_number: gstin || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        payment_terms: form.payment_terms || null,
        lead_time_days: Number(form.lead_time_days) || 7,
        min_order_quantity: form.min_order_quantity ? Number(form.min_order_quantity) : null,
        rating: Number(form.rating) || 0,
      };
      if (editingId) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert({ org_id: orgId!, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Supplier updated" : "Supplier created");
      setOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["suppliers", orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save supplier"),
  });

  const startEdit = (sup: NonNullable<typeof suppliers.data>[number]) => {
    setForm({
      name: sup.name,
      code: sup.code ?? "",
      contact_person: sup.contact_person ?? "",
      email: sup.email ?? "",
      phone: sup.phone ?? "",
      gst_number: sup.gst_number ?? "",
      address: sup.address ?? "",
      city: sup.city ?? "",
      state: sup.state ?? "",
      payment_terms: sup.payment_terms ?? "",
      lead_time_days: String(sup.lead_time_days ?? 7),
      min_order_quantity: sup.min_order_quantity != null ? String(sup.min_order_quantity) : "",
      rating: String(sup.rating ?? 0),
    });
    setEditingId(sup.id);
    setOpen(true);
  };

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("suppliers").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers", orgId] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update supplier"),
  });

  return (
    <AppShell
      title="Suppliers"
      description="Vendors and procurement contacts."
      actions={
        canEdit && (
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
                New supplier
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit supplier" : "New supplier"}</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSupplier.mutate();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sup-name">Name</Label>
                    <Input
                      id="sup-name"
                      required
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Acme Traders"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-code">Code</Label>
                    <Input
                      id="sup-code"
                      value={form.code}
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-contact">Contact person</Label>
                    <Input
                      id="sup-contact"
                      value={form.contact_person}
                      onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-phone">Phone</Label>
                    <Input
                      id="sup-phone"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-email">Email</Label>
                    <Input
                      id="sup-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-gst">GSTIN</Label>
                    <Input
                      id="sup-gst"
                      value={form.gst_number}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, gst_number: e.target.value.toUpperCase() }))
                      }
                      placeholder="22AAAAA0000A1Z5"
                      maxLength={15}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-address">Address</Label>
                    <Input
                      id="sup-address"
                      value={form.address}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-city">City</Label>
                    <Input
                      id="sup-city"
                      value={form.city}
                      onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-state">State (for GST place of supply)</Label>
                    <Select
                      value={form.state}
                      onValueChange={(v) => setForm((f) => ({ ...f, state: v }))}
                    >
                      <SelectTrigger id="sup-state">
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
                    <Label htmlFor="sup-terms">Payment terms</Label>
                    <Input
                      id="sup-terms"
                      value={form.payment_terms}
                      onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))}
                      placeholder="Net 30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-lead">Lead time (days)</Label>
                    <Input
                      id="sup-lead"
                      type="number"
                      min={0}
                      value={form.lead_time_days}
                      onChange={(e) => setForm((f) => ({ ...f, lead_time_days: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-moq">Minimum order quantity</Label>
                    <Input
                      id="sup-moq"
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.min_order_quantity}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, min_order_quantity: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sup-rating">Rating (0-5)</Label>
                    <Input
                      id="sup-rating"
                      type="number"
                      min={0}
                      max={5}
                      step="0.5"
                      value={form.rating}
                      onChange={(e) => setForm((f) => ({ ...f, rating: e.target.value }))}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saveSupplier.isPending}>
                    {saveSupplier.isPending
                      ? "Saving…"
                      : editingId
                        ? "Save changes"
                        : "Create supplier"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {suppliers.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !suppliers.data || suppliers.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <Truck className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No suppliers yet. Add your first one.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Lead time</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Status</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.data.map((sup) => (
                  <TableRow key={sup.id}>
                    <TableCell className="font-medium">{sup.name}</TableCell>
                    <TableCell>{sup.contact_person ?? "—"}</TableCell>
                    <TableCell>{sup.phone ?? "—"}</TableCell>
                    <TableCell>{sup.lead_time_days}d</TableCell>
                    <TableCell>
                      {Number(sup.rating) > 0 ? (
                        <span className="flex items-center gap-1">
                          <Star className="size-3.5 fill-warn text-warn" />
                          {Number(sup.rating).toFixed(1)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sup.is_active ? "default" : "secondary"}>
                        {sup.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(sup)}>
                          <Pencil className="size-4" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            toggleActive.mutate({ id: sup.id, is_active: !sup.is_active })
                          }
                        >
                          {sup.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 sm:hidden">
            {suppliers.data.map((sup) => (
              <div key={sup.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{sup.name}</p>
                    <p className="text-xs text-muted-foreground">{sup.contact_person ?? "—"}</p>
                  </div>
                  <Badge variant={sup.is_active ? "default" : "secondary"} className="shrink-0">
                    {sup.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="truncate">{sup.phone ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Lead time</p>
                    <p>{sup.lead_time_days}d</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Rating</p>
                    {Number(sup.rating) > 0 ? (
                      <span className="flex items-center gap-1">
                        <Star className="size-3.5 fill-warn text-warn" />
                        {Number(sup.rating).toFixed(1)}
                      </span>
                    ) : (
                      <p>—</p>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(sup)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive.mutate({ id: sup.id, is_active: !sup.is_active })}
                    >
                      {sup.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
