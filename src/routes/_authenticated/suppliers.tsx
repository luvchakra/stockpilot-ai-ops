import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Truck } from "lucide-react";
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
  payment_terms: "",
  lead_time_days: "7",
};

function Suppliers() {
  const { org } = useCurrentOrg();
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
      const payload = {
        name: form.name,
        code: form.code || null,
        contact_person: form.contact_person || null,
        email: form.email || null,
        phone: form.phone || null,
        gst_number: form.gst_number || null,
        payment_terms: form.payment_terms || null,
        lead_time_days: Number(form.lead_time_days) || 7,
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
      payment_terms: sup.payment_terms ?? "",
      lead_time_days: String(sup.lead_time_days ?? 7),
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
                    onChange={(e) => setForm((f) => ({ ...f, gst_number: e.target.value }))}
                  />
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
        <div className="panel overflow-x-auto rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Lead time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
                    <Badge variant={sup.is_active ? "default" : "secondary"}>
                      {sup.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
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
