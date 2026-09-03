import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateEwayBill, cancelEwayBill } from "@/lib/eway-bill-actions";
import {
  EWAY_BILL_THRESHOLD_INR,
  TRANSPORT_MODE_LABEL,
  isWithinCancelWindow,
  type EwayBillSourceType,
  type EwayBillTransportMode,
} from "@/lib/eway-bill";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { Truck } from "lucide-react";

interface EwayBillPanelProps {
  orgId: string;
  sourceType: EwayBillSourceType;
  sourceId: string;
  totalValue: number;
  canGenerate: boolean;
  canCancel: boolean;
}

export function EwayBillPanel({
  orgId,
  sourceType,
  sourceId,
  totalValue,
  canGenerate,
  canCancel,
}: EwayBillPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = ["eway-bill", orgId, sourceType, sourceId];
  const [formOpen, setFormOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [transportMode, setTransportMode] = useState<EwayBillTransportMode>("road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [counterpartyPincode, setCounterpartyPincode] = useState("");
  const [counterpartyPlace, setCounterpartyPlace] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const bill = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eway_bills")
        .select(
          "id, ewb_number, ewb_date, valid_until, status, transport_mode, vehicle_number, transporter_name",
        )
        .eq("org_id", orgId)
        .eq("source_type", sourceType)
        .eq("source_id", sourceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return "Something went wrong talking to the e-Way Bill provider.";
  };

  const submitGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await generateEwayBill({
        data: {
          orgId,
          sourceType,
          sourceId,
          transportMode,
          ...(vehicleNumber ? { vehicleNumber } : {}),
          ...(transporterId ? { transporterId } : {}),
          ...(transporterName ? { transporterName } : {}),
          ...(distanceKm ? { distanceKm: Number(distanceKm) } : {}),
          ...(counterpartyPincode ? { counterpartyPincode } : {}),
          ...(counterpartyPlace ? { counterpartyPlace } : {}),
        },
      });
      toast.success("e-Way Bill generated");
      setFormOpen(false);
      setVehicleNumber("");
      setTransporterId("");
      setTransporterName("");
      setDistanceKm("");
      setCounterpartyPincode("");
      setCounterpartyPlace("");
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bill.data) return;
    setBusy(true);
    try {
      await cancelEwayBill({
        data: {
          orgId,
          ewayBillId: bill.data.id,
          ...(cancelReason ? { reason: cancelReason } : {}),
        },
      });
      toast.success("e-Way Bill cancelled");
      setCancelOpen(false);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const active = bill.data?.status === "generated" ? bill.data : null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">e-Way Bill</span>
          {active ? (
            <Badge variant="default">{active.ewb_number}</Badge>
          ) : bill.data?.status === "cancelled" ? (
            <Badge variant="outline">Cancelled</Badge>
          ) : (
            <Badge variant="outline">Not generated</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {active && canCancel && isWithinCancelWindow(active.ewb_date) ? (
            <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
              Cancel
            </Button>
          ) : null}
          {!active && canGenerate ? (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              Generate e-Way Bill
            </Button>
          ) : null}
        </div>
      </div>
      {active ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Valid until {formatDateTime(active.valid_until)} ·{" "}
          {TRANSPORT_MODE_LABEL[active.transport_mode as EwayBillTransportMode] ??
            active.transport_mode}
          {active.vehicle_number ? ` · ${active.vehicle_number}` : ""}
        </p>
      ) : null}
      {!active && !bill.data && totalValue < EWAY_BILL_THRESHOLD_INR ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This transaction is below the ₹{EWAY_BILL_THRESHOLD_INR.toLocaleString("en-IN")} e-Way
          Bill threshold — generation is optional.
        </p>
      ) : null}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate e-Way Bill</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitGenerate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ewb-transport-mode">Transport mode</Label>
              <Select
                value={transportMode}
                onValueChange={(v) => setTransportMode(v as EwayBillTransportMode)}
              >
                <SelectTrigger id="ewb-transport-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TRANSPORT_MODE_LABEL) as [EwayBillTransportMode, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ewb-vehicle">Vehicle number</Label>
                <Input
                  id="ewb-vehicle"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="MH12AB1234"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ewb-distance">Distance (km)</Label>
                <Input
                  id="ewb-distance"
                  type="number"
                  min="0"
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ewb-transporter-id">Transporter ID (GSTIN)</Label>
                <Input
                  id="ewb-transporter-id"
                  value={transporterId}
                  onChange={(e) => setTransporterId(e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ewb-transporter-name">Transporter name</Label>
                <Input
                  id="ewb-transporter-name"
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ewb-place">Counterparty place</Label>
                <Input
                  id="ewb-place"
                  value={counterpartyPlace}
                  onChange={(e) => setCounterpartyPlace(e.target.value)}
                  placeholder="City / town"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ewb-pincode">Counterparty pincode</Label>
                <Input
                  id="ewb-pincode"
                  value={counterpartyPincode}
                  onChange={(e) => setCounterpartyPincode(e.target.value)}
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
            <DialogTitle>Cancel e-Way Bill</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCancel} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This cancels {active?.ewb_number} with the provider. e-Way Bills can only be cancelled
              within 24 hours of generation.
            </p>
            <div className="space-y-2">
              <Label htmlFor="ewb-cancel-reason">Reason (optional)</Label>
              <Textarea
                id="ewb-cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={busy}>
                {busy ? "Cancelling…" : "Cancel e-Way Bill"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
