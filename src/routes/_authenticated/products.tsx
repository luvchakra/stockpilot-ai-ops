import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { inr } from "@/lib/format";
import { GST_RATE_SLABS } from "@/lib/gst";
import { ProductImportDialog } from "@/components/product-import-dialog";
import { usePermissions } from "@/hooks/usePermissions";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({
    meta: [
      { title: "Products — StockPilot" },
      { name: "description", content: "Manage your product catalogue and SKUs." },
    ],
  }),
  component: Products,
});

const emptyForm = {
  sku: "",
  name: "",
  brand: "",
  barcode: "",
  description: "",
  category: "",
  supplier_id: "",
  unit: "pcs",
  hsn_code: "",
  tax_rate: "18",
  cost_price: "0",
  selling_price: "0",
  reorder_point: "0",
  reorder_quantity: "0",
};

function Products() {
  const { org } = useCurrentOrg();
  const { can } = usePermissions();
  const orgId = org?.id;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canEdit = can("inventory.edit");
  const canDelete = can("inventory.delete");
  const canViewCost = can("inventory.view_cost");

  // Reads from products_safe, not products directly, so cost_price comes
  // back null for any role lacking inventory.view_cost -- enforced by the
  // view at the database level, not just hidden here in the UI. Category
  // and supplier names are joined client-side (rather than embedded in the
  // select) since view-based PostgREST embedding is less predictable than
  // on a real table.
  const products = useQuery({
    queryKey: ["products", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_safe")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const categories = useQuery({
    queryKey: ["categories", orgId, "lookup"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name")
        .eq("org_id", orgId!);
      if (error) throw error;
      return data;
    },
  });
  const categoryNameById = new Map((categories.data ?? []).map((c) => [c.id, c.name]));

  const suppliers = useQuery({
    queryKey: ["suppliers", orgId, "active"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("org_id", orgId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const supplierNameById = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]));

  const saveProduct = useMutation({
    mutationFn: async () => {
      let category_id: string | null = null;
      const categoryName = form.category.trim();
      if (categoryName) {
        const { data: existing } = await supabase
          .from("categories")
          .select("id")
          .eq("org_id", orgId!)
          .ilike("name", categoryName)
          .maybeSingle();
        if (existing) {
          category_id = existing.id;
        } else {
          const { data: created, error: catError } = await supabase
            .from("categories")
            .insert({ org_id: orgId!, name: categoryName })
            .select("id")
            .single();
          if (catError) throw catError;
          category_id = created.id;
        }
      }

      const payload = {
        sku: form.sku,
        name: form.name,
        brand: form.brand || null,
        barcode: form.barcode || null,
        description: form.description || null,
        category_id,
        supplier_id: form.supplier_id || null,
        unit: form.unit,
        hsn_code: form.hsn_code || null,
        tax_rate: Number(form.tax_rate) || 0,
        cost_price: Number(form.cost_price) || 0,
        selling_price: Number(form.selling_price) || 0,
        reorder_point: Number(form.reorder_point) || 0,
        reorder_quantity: Number(form.reorder_quantity) || 0,
      };
      if (editingId) {
        const { error } = await supabase.from("products").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert({ org_id: orgId!, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Product updated" : "Product created");
      setOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["products", orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save product"),
  });

  const startEdit = (p: NonNullable<typeof products.data>[number]) => {
    setForm({
      sku: p.sku ?? "",
      name: p.name ?? "",
      brand: p.brand ?? "",
      barcode: p.barcode ?? "",
      description: p.description ?? "",
      category: categoryNameById.get(p.category_id ?? "") ?? "",
      supplier_id: p.supplier_id ?? "",
      unit: p.unit ?? "pcs",
      hsn_code: p.hsn_code ?? "",
      tax_rate: String(p.tax_rate ?? 0),
      cost_price: String(p.cost_price ?? 0),
      selling_price: String(p.selling_price ?? 0),
      reorder_point: String(p.reorder_point ?? 0),
      reorder_quantity: String(p.reorder_quantity ?? 0),
    });
    setEditingId(p.id);
    setOpen(true);
  };

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("products").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products", orgId] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update product"),
  });

  return (
    <AppShell
      title="Products"
      description="Your product catalogue and SKUs."
      actions={
        canEdit && (
          <div className="flex flex-wrap gap-2">
            <ProductImportDialog
              orgId={orgId ?? ""}
              existingSkus={(products.data ?? []).map((p) => p.sku ?? "")}
              suppliers={suppliers.data ?? []}
              onImported={() => queryClient.invalidateQueries({ queryKey: ["products", orgId] })}
            />
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
                  New product
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingId ? "Edit product" : "New product"}</DialogTitle>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveProduct.mutate();
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="p-sku">SKU</Label>
                      <Input
                        id="p-sku"
                        required
                        value={form.sku}
                        onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                        placeholder="SKU-1001"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-name">Name</Label>
                      <Input
                        id="p-name"
                        required
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-brand">Brand</Label>
                      <Input
                        id="p-brand"
                        value={form.brand}
                        onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-barcode">Barcode</Label>
                      <Input
                        id="p-barcode"
                        value={form.barcode}
                        onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                        placeholder="EAN / UPC / Code128"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-category">Category</Label>
                      <Input
                        id="p-category"
                        value={form.category}
                        onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                        placeholder="Beauty"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-supplier">Preferred supplier</Label>
                      <Select
                        value={form.supplier_id}
                        onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v }))}
                      >
                        <SelectTrigger id="p-supplier">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          {(suppliers.data ?? []).map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-unit">Unit</Label>
                      <Input
                        id="p-unit"
                        value={form.unit}
                        onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-hsn">HSN code</Label>
                      <Input
                        id="p-hsn"
                        value={form.hsn_code}
                        onChange={(e) => setForm((f) => ({ ...f, hsn_code: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-tax">GST rate</Label>
                      <Select
                        value={form.tax_rate}
                        onValueChange={(v) => setForm((f) => ({ ...f, tax_rate: v }))}
                      >
                        <SelectTrigger id="p-tax">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GST_RATE_SLABS.map((rate) => (
                            <SelectItem key={rate} value={String(rate)}>
                              {rate}%
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-cost">Cost price</Label>
                      <Input
                        id="p-cost"
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.cost_price}
                        onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-price">Selling price</Label>
                      <Input
                        id="p-price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.selling_price}
                        onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-reorder-point">Reorder point</Label>
                      <Input
                        id="p-reorder-point"
                        type="number"
                        min={0}
                        value={form.reorder_point}
                        onChange={(e) => setForm((f) => ({ ...f, reorder_point: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="p-reorder-qty">Reorder quantity</Label>
                      <Input
                        id="p-reorder-qty"
                        type="number"
                        min={0}
                        value={form.reorder_quantity}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, reorder_quantity: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="p-description">Description</Label>
                    <Textarea
                      id="p-description"
                      rows={3}
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={saveProduct.isPending}>
                      {saveProduct.isPending
                        ? "Saving…"
                        : editingId
                          ? "Save changes"
                          : "Create product"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )
      }
    >
      {products.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !products.data || products.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <Package className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No products yet. Add your first SKU.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Supplier</TableHead>
                  {canViewCost && <TableHead className="text-right">Cost</TableHead>}
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Status</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.brand ?? "—"}</TableCell>
                    <TableCell>{categoryNameById.get(p.category_id ?? "") ?? "—"}</TableCell>
                    <TableCell>{supplierNameById.get(p.supplier_id ?? "") ?? "—"}</TableCell>
                    {canViewCost && (
                      <TableCell className="text-right">
                        {p.cost_price == null ? "—" : inr.format(Number(p.cost_price))}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {inr.format(Number(p.selling_price))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : "secondary"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                          <Pencil className="size-4" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            toggleStatus.mutate({
                              id: p.id!,
                              status: p.status === "active" ? "inactive" : "active",
                            })
                          }
                        >
                          {p.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 sm:hidden">
            {products.data.map((p) => (
              <div key={p.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <Badge
                    variant={p.status === "active" ? "default" : "secondary"}
                    className="shrink-0"
                  >
                    {p.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Brand</p>
                    <p className="truncate">{p.brand ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Category</p>
                    <p className="truncate">{categoryNameById.get(p.category_id ?? "") ?? "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Supplier</p>
                    <p className="truncate">{supplierNameById.get(p.supplier_id ?? "") ?? "—"}</p>
                  </div>
                  {canViewCost && (
                    <div>
                      <p className="text-xs text-muted-foreground">Cost</p>
                      <p>{p.cost_price == null ? "—" : inr.format(Number(p.cost_price))}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Price</p>
                    <p>{inr.format(Number(p.selling_price))}</p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        toggleStatus.mutate({
                          id: p.id!,
                          status: p.status === "active" ? "inactive" : "active",
                        })
                      }
                    >
                      {p.status === "active" ? "Deactivate" : "Activate"}
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
