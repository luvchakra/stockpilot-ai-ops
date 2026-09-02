import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { parseSpreadsheetFile } from "@/lib/spreadsheet";
import {
  IMPORT_FIELDS,
  IGNORE_COLUMN,
  autoMapColumns,
  buildRowsFromMapping,
  validateRows,
  buildTemplateCsv,
  buildErrorRowsCsv,
  downloadTextFile,
  type ColumnMapping,
  type ImportField,
  type ImportFieldKey,
  type ImportRow,
} from "@/lib/product-import";
import { cn } from "@/lib/utils";

type Step = "upload" | "map" | "preview" | "result";

interface ImportResult {
  created: number;
  skipped: { sourceRowNumber: number; sku: string; reason: string }[];
}

interface ProductImportDialogProps {
  orgId: string;
  existingSkus: string[];
  suppliers: { id: string; name: string }[];
  onImported: () => void;
}

const CHUNK_SIZE = 100;

function revalidate(rows: ImportRow[], existingSkusLower: Set<string>): ImportRow[] {
  const fresh = validateRows(
    rows.map((r) => ({ id: r.id, sourceRowNumber: r.sourceRowNumber, values: r.values })),
    existingSkusLower,
  );
  return fresh.map((row, i) => {
    if (row.errors.length > 0) return { ...row, included: false };
    const prev = rows[i];
    return { ...row, included: !prev || prev.errors.length > 0 ? true : prev.included };
  });
}

export function ProductImportDialog({
  orgId,
  existingSkus,
  suppliers,
  onImported,
}: ProductImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [parsing, setParsing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingSkusLower = new Set(existingSkus.map((s) => s.toLowerCase()));

  const reset = () => {
    setStep("upload");
    setParsing(false);
    setUploadError(null);
    setFileName(null);
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setRows([]);
    setCommitting(false);
    setResult(null);
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setUploadError(null);
    try {
      const grid = await parseSpreadsheetFile(file);
      if (grid.length === 0) throw new Error("No rows found in this file.");
      if (grid.length > 5001) {
        throw new Error(
          "This file has more than 5,000 rows — please split it into smaller files and import each separately.",
        );
      }
      const [headerRow, ...body] = grid;
      const cleanHeaders = (headerRow ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
      const initialMapping = autoMapColumns(cleanHeaders);
      setFileName(file.name);
      setHeaders(cleanHeaders);
      setDataRows(body);
      setMapping(initialMapping);
      setStep("map");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not read this file.");
    } finally {
      setParsing(false);
    }
  };

  const targetUsedElsewhere = (key: ImportFieldKey, colIndex: number) =>
    Object.entries(mapping).some(([idx, val]) => Number(idx) !== colIndex && val === key);

  const setColumnMapping = (colIndex: number, value: ImportFieldKey | typeof IGNORE_COLUMN) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (value !== IGNORE_COLUMN) {
        for (const idx of Object.keys(next)) {
          if (Number(idx) !== colIndex && next[Number(idx)] === value) {
            next[Number(idx)] = IGNORE_COLUMN;
          }
        }
      }
      next[colIndex] = value;
      return next;
    });
  };

  const mappedRequiredKeys = new Set(Object.values(mapping));
  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && !mappedRequiredKeys.has(f.key));

  const goToPreview = () => {
    const built = buildRowsFromMapping(dataRows, mapping);
    const validated = validateRows(built, existingSkusLower);
    setRows(validated);
    setStep("preview");
  };

  const mappedFields: ImportField[] = IMPORT_FIELDS.filter((f) =>
    Object.values(mapping).includes(f.key),
  );

  const updateRowValue = (rowId: string, key: ImportFieldKey, value: string) => {
    setRows((prev) => {
      const next = prev.map((r) =>
        r.id === rowId ? { ...r, values: { ...r.values, [key]: value } } : r,
      );
      return revalidate(next, existingSkusLower);
    });
  };

  const toggleRowIncluded = (rowId: string, included: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, included } : r)));
  };

  const includedCount = rows.filter((r) => r.included).length;
  const errorCount = rows.filter((r) => r.errors.length > 0).length;

  const commit = async () => {
    setCommitting(true);
    try {
      const toImport = rows.filter((r) => r.included);

      const categoryCache = new Map<string, string | null>();
      const resolveCategoryId = async (name: string): Promise<string | null> => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const key = trimmed.toLowerCase();
        if (categoryCache.has(key)) return categoryCache.get(key) ?? null;
        const { data: existingCategory } = await supabase
          .from("categories")
          .select("id")
          .eq("org_id", orgId)
          .ilike("name", trimmed)
          .maybeSingle();
        if (existingCategory) {
          categoryCache.set(key, existingCategory.id);
          return existingCategory.id;
        }
        const { data: created, error } = await supabase
          .from("categories")
          .insert({ org_id: orgId, name: trimmed })
          .select("id")
          .single();
        if (error) {
          categoryCache.set(key, null);
          return null;
        }
        categoryCache.set(key, created.id);
        return created.id;
      };

      const supplierByName = new Map(
        suppliers.map((s) => [s.name.trim().toLowerCase(), s.id] as const),
      );

      type Payload = {
        sourceRowNumber: number;
        sku: string;
        payload: Record<string, unknown>;
      };
      const payloads: Payload[] = [];
      for (const row of toImport) {
        const v = row.values;
        const categoryName = v.category?.trim();
        const category_id = categoryName ? await resolveCategoryId(categoryName) : null;
        const supplierName = v.supplier?.trim().toLowerCase();
        const supplier_id = supplierName ? (supplierByName.get(supplierName) ?? null) : null;

        payloads.push({
          sourceRowNumber: row.sourceRowNumber,
          sku: v.sku ?? "",
          payload: {
            org_id: orgId,
            sku: v.sku,
            name: v.name,
            brand: v.brand || null,
            barcode: v.barcode || null,
            description: v.description || null,
            category_id,
            supplier_id,
            unit: v.unit?.trim() || "pcs",
            hsn_code: v.hsn_code || null,
            tax_rate: v.tax_rate ? Number(v.tax_rate) : 18,
            cost_price: v.cost_price ? Number(v.cost_price) : 0,
            selling_price: v.selling_price ? Number(v.selling_price) : 0,
            reorder_point: v.reorder_point ? Number(v.reorder_point) : 0,
            reorder_quantity: v.reorder_quantity ? Number(v.reorder_quantity) : 0,
          },
        });
      }

      let created = 0;
      const skipped: ImportResult["skipped"] = [];

      for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
        const chunk = payloads.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from("products").insert(chunk.map((c) => c.payload));
        if (!error) {
          created += chunk.length;
          continue;
        }
        // A row in this chunk failed (e.g. race-condition duplicate SKU) — retry one-by-one so the rest still lands.
        for (const item of chunk) {
          const { error: rowError } = await supabase.from("products").insert(item.payload);
          if (rowError) {
            skipped.push({
              sourceRowNumber: item.sourceRowNumber,
              sku: item.sku,
              reason:
                rowError.code === "23505"
                  ? "SKU already exists in your catalogue"
                  : rowError.message,
            });
          } else {
            created++;
          }
        }
      }

      setResult({ created, skipped });
      setStep("result");
      if (created > 0) onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="size-4" />
          Import products
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import products</DialogTitle>
        </DialogHeader>

        {step === "upload" ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                {parsing ? "Reading file…" : "Click to choose a .csv or .xlsx file"}
              </p>
              <p className="text-xs text-muted-foreground">
                First row must be column headers. Up to 5,000 rows.
              </p>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFile(file);
              }}
            />
            {uploadError ? (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {uploadError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadTextFile("stockpilot-product-import-template.csv", buildTemplateCsv())
              }
            >
              <Download className="size-4" />
              Download CSV template
            </Button>
          </div>
        ) : null}

        {step === "map" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {fileName} — match each column to a product field, or ignore it.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">File column</th>
                    <th className="px-3 py-2">Sample value</th>
                    <th className="px-3 py-2">Maps to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {headers.map((header, colIndex) => (
                    <tr key={colIndex}>
                      <td className="px-3 py-2 font-medium">{header}</td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                        {dataRows[0]?.[colIndex] || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={mapping[colIndex] ?? IGNORE_COLUMN}
                          onValueChange={(v) =>
                            setColumnMapping(colIndex, v as ImportFieldKey | typeof IGNORE_COLUMN)
                          }
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={IGNORE_COLUMN}>Ignore this column</SelectItem>
                            {IMPORT_FIELDS.filter((f) => !targetUsedElsewhere(f.key, colIndex)).map(
                              (f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  {f.label}
                                  {f.required ? " *" : ""}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missingRequired.length > 0 ? (
              <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Map a column for: {missingRequired.map((f) => f.label).join(", ")}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>
                Start over
              </Button>
              <Button type="button" onClick={goToPreview} disabled={missingRequired.length > 0}>
                Continue to preview
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === "preview" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {includedCount} of {rows.length} rows will be imported.
                {errorCount > 0 ? ` ${errorCount} row${errorCount === 1 ? "" : "s"} flagged.` : ""}
              </p>
              {errorCount > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadTextFile("stockpilot-import-errors.csv", buildErrorRowsCsv(rows))
                  }
                >
                  <Download className="size-4" />
                  Download error rows
                </Button>
              ) : null}
            </div>

            <div className="hidden overflow-x-auto rounded-2xl border border-border sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Include</th>
                    {mappedFields.map((f) => (
                      <th key={f.key} className="px-3 py-2">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-3 py-2">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className={cn(row.errors.length > 0 && "bg-destructive/5")}>
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={row.included}
                          disabled={row.errors.length > 0}
                          onCheckedChange={(checked) => toggleRowIncluded(row.id, checked === true)}
                        />
                      </td>
                      {mappedFields.map((f) => (
                        <td key={f.key} className="px-3 py-2">
                          <Input
                            className="h-8 w-32 text-xs"
                            value={row.values[f.key] ?? ""}
                            onChange={(e) => updateRowValue(row.id, f.key, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-xs text-destructive">
                        {row.errors.join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 sm:hidden">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "panel space-y-3 rounded-2xl border border-border p-4",
                    row.errors.length > 0 && "border-destructive/40 bg-destructive/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Row {row.sourceRowNumber}</p>
                    <Checkbox
                      checked={row.included}
                      disabled={row.errors.length > 0}
                      onCheckedChange={(checked) => toggleRowIncluded(row.id, checked === true)}
                    />
                  </div>
                  <div className="space-y-2">
                    {mappedFields.map((f) => (
                      <div key={f.key} className="space-y-1">
                        <p className="text-xs text-muted-foreground">{f.label}</p>
                        <Input
                          className="h-8 text-xs"
                          value={row.values[f.key] ?? ""}
                          onChange={(e) => updateRowValue(row.id, f.key, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  {row.errors.length > 0 ? (
                    <p className="text-xs text-destructive">{row.errors.join("; ")}</p>
                  ) : null}
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>
                Start over
              </Button>
              <Button type="button" onClick={commit} disabled={committing || includedCount === 0}>
                {committing
                  ? "Importing…"
                  : `Import ${includedCount} product${includedCount === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === "result" && result ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-signal/30 bg-signal/10 p-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-signal" />
              <div>
                <p className="font-medium">
                  {result.created} product{result.created === 1 ? "" : "s"} created
                </p>
                {result.skipped.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} skipped —
                    see below.
                  </p>
                ) : null}
              </div>
            </div>

            {result.skipped.length > 0 ? (
              <div className="space-y-2">
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {result.skipped.map((s) => (
                    <div
                      key={s.sourceRowNumber}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          Row {s.sourceRowNumber} — {s.sku}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{s.reason}</p>
                      </div>
                      <Badge variant="destructive" className="shrink-0">
                        Skipped
                      </Badge>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const csv = buildErrorRowsCsv(
                      rows.map((r) =>
                        result.skipped.some((s) => s.sourceRowNumber === r.sourceRowNumber)
                          ? {
                              ...r,
                              errors: [
                                result.skipped.find((s) => s.sourceRowNumber === r.sourceRowNumber)
                                  ?.reason ?? "Skipped",
                              ],
                            }
                          : { ...r, errors: [] },
                      ),
                    );
                    downloadTextFile("stockpilot-import-skipped.csv", csv);
                  }}
                >
                  <Download className="size-4" />
                  Download skipped rows
                </Button>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>
                Import another file
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
