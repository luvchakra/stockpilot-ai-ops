import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BarcodeImage, BARCODE_FORMATS, type BarcodeFormat } from "@/components/barcode-image";

interface LabelProduct {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
}

interface BarcodeLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  products: LabelProduct[];
  /** Pre-checked products, e.g. a single row's "Barcode" action. */
  initialSelectedIds?: string[];
}

// Products encode their SKU by default (per the ticket: "let the user
// choose which field to encode -- SKU by default"), and reuse an existing
// barcode value rather than overwriting it, so re-printing a label never
// changes a code that's already out on a shelf or box somewhere.
function encodedValueFor(p: LabelProduct) {
  return p.barcode || p.sku;
}

export function BarcodeLabelDialog({
  open,
  onOpenChange,
  orgId,
  products,
  initialSelectedIds,
}: BarcodeLabelDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"select" | "preview">("select");
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState<BarcodeFormat>("code128");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? []),
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [products, search]);

  const selected = products.filter((p) => selectedIds.has(p.id));

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Only writes products.barcode for rows that don't already have one --
  // never overwrites an existing value.
  const generate = useMutation({
    mutationFn: async () => {
      const toStore = selected.filter((p) => !p.barcode);
      for (const p of toStore) {
        const { error } = await supabase.from("products").update({ barcode: p.sku }).eq("id", p.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      setStep("preview");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not generate barcodes"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {step === "select" ? (
          <>
            <DialogHeader>
              <DialogTitle>Generate Barcode / QR labels</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Format</label>
                  <Select value={format} onValueChange={(v) => setFormat(v as BarcodeFormat)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BARCODE_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Search products</label>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by SKU or name…"
                  />
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                {filtered.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={selectedIds.has(p.id)}
                      onCheckedChange={() => toggle(p.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {p.sku}
                    </span>
                  </label>
                ))}
                {filtered.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No products match "{search}".
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selected.length} product{selected.length === 1 ? "" : "s"} selected
                </p>
                <Button
                  onClick={() => generate.mutate()}
                  disabled={selected.length === 0 || generate.isPending}
                >
                  <QrCode className="size-4" />
                  {generate.isPending ? "Generating…" : "Generate & preview"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="no-print">
              <DialogTitle>{selected.length} label(s) ready to print</DialogTitle>
            </DialogHeader>
            <div className="no-print mb-4 flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="size-4" />
                Print
              </Button>
            </div>
            <div className="print-area label-sheet flex flex-wrap gap-3">
              {selected.map((p) => (
                <div
                  key={p.id}
                  className="label-card flex flex-col items-center justify-center gap-1 rounded-md border border-border p-2 text-center"
                >
                  <BarcodeImage value={encodedValueFor(p)} format={format} size={64} />
                  <p className="truncate text-[10px] font-medium">{p.name}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
