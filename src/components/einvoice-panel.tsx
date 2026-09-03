import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateEinvoice, cancelEinvoice } from "@/lib/einvoice-actions";
import { isWithinCancelWindow } from "@/lib/einvoice";
import { QrCodeImage } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { FileCheck2 } from "lucide-react";

interface EinvoiceQueryArgs {
  orgId: string;
  invoiceId: string;
}

function useEinvoiceQuery({ orgId, invoiceId }: EinvoiceQueryArgs) {
  return useQuery({
    queryKey: ["einvoice", orgId, invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("einvoices")
        .select("id, irn, ack_no, ack_date, qr_code, status")
        .eq("org_id", orgId)
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Print-visible half: the IRN + QR code that must appear on the printed
// invoice. Renders nothing until an e-Invoice has actually been generated.
export function EinvoiceQrBlock({ orgId, invoiceId }: EinvoiceQueryArgs) {
  const einvoice = useEinvoiceQuery({ orgId, invoiceId });
  const active = einvoice.data?.status === "generated" ? einvoice.data : null;
  if (!active) return null;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-4">
      <QrCodeImage value={active.qr_code} size={96} className="shrink-0 rounded" />
      <div className="min-w-0 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">IRN</p>
        <p className="break-all font-mono text-xs font-medium">{active.irn}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ack No {active.ack_no} · {formatDateTime(active.ack_date)}
        </p>
      </div>
    </div>
  );
}

interface EinvoicePanelProps extends EinvoiceQueryArgs {
  canGenerate: boolean;
  canCancel: boolean;
}

// No-print half: status badge + generate/cancel controls. Shares the
// same query key as EinvoiceQrBlock, so both stay in sync automatically.
export function EinvoicePanel({ orgId, invoiceId, canGenerate, canCancel }: EinvoicePanelProps) {
  const queryClient = useQueryClient();
  const queryKey = ["einvoice", orgId, invoiceId];
  const einvoice = useEinvoiceQuery({ orgId, invoiceId });
  const [formOpen, setFormOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [buyerPincode, setBuyerPincode] = useState("");
  const [buyerPlace, setBuyerPlace] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const active = einvoice.data?.status === "generated" ? einvoice.data : null;

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return "Something went wrong talking to the e-Invoicing provider.";
  };

  const submitGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await generateEinvoice({
        data: {
          orgId,
          invoiceId,
          ...(buyerPincode ? { buyerPincode } : {}),
          ...(buyerPlace ? { buyerPlace } : {}),
        },
      });
      toast.success("e-Invoice generated");
      setFormOpen(false);
      setBuyerPincode("");
      setBuyerPlace("");
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    try {
      await cancelEinvoice({
        data: {
          orgId,
          einvoiceId: active.id,
          ...(cancelReason ? { reason: cancelReason } : {}),
        },
      });
      toast.success("e-Invoice cancelled");
      setCancelOpen(false);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="no-print rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">e-Invoice (IRN)</span>
          {active ? (
            <Badge variant="default">Generated</Badge>
          ) : einvoice.data?.status === "cancelled" ? (
            <Badge variant="outline">Cancelled</Badge>
          ) : (
            <Badge variant="outline">Not generated</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {active && canCancel && isWithinCancelWindow(active.ack_date) ? (
            <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
              Cancel
            </Button>
          ) : null}
          {!active && canGenerate ? (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              Generate e-Invoice
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate e-Invoice</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitGenerate} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Submits this invoice to the IRP and records the returned IRN and QR code. The buyer's
              pincode isn't captured on the customer record yet, so enter it here.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="einv-buyer-place">Buyer place</Label>
                <Input
                  id="einv-buyer-place"
                  value={buyerPlace}
                  onChange={(e) => setBuyerPlace(e.target.value)}
                  placeholder="City / town"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="einv-buyer-pincode">Buyer pincode</Label>
                <Input
                  id="einv-buyer-pincode"
                  value={buyerPincode}
                  onChange={(e) => setBuyerPincode(e.target.value)}
                  maxLength={6}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? "Generating…" : "Generate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel e-Invoice</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCancel} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This cancels IRN {active?.irn} with the provider. e-Invoices can only be cancelled
              within 24 hours of generation.
            </p>
            <div className="space-y-2">
              <Label htmlFor="einv-cancel-reason">Reason (optional)</Label>
              <Textarea
                id="einv-cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={busy}>
                {busy ? "Cancelling…" : "Cancel e-Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
