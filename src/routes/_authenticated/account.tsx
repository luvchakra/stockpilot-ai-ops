import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDIAN_STATES, isValidGstin } from "@/lib/gst";
import { usePermissions } from "@/hooks/usePermissions";
import { formatDateTime } from "@/lib/format";

const CURRENCIES = [
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "AUD", label: "AUD — Australian Dollar" },
];

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Account — StockPilot" },
      { name: "description", content: "Manage your StockPilot account profile." },
    ],
  }),
  component: Account,
});

function Account() {
  const { user } = useAuth();
  const { org } = useCurrentOrg();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgIndustry, setOrgIndustry] = useState("");
  const [orgCurrency, setOrgCurrency] = useState("INR");
  const [orgTimezone, setOrgTimezone] = useState("Asia/Kolkata");
  const [orgGstin, setOrgGstin] = useState("");
  const [orgState, setOrgState] = useState("");
  const [orgGstType, setOrgGstType] = useState("regular");
  const [orgBusy, setOrgBusy] = useState(false);

  const [ewbProvider, setEwbProvider] = useState("");
  const [ewbAuthUrl, setEwbAuthUrl] = useState("");
  const [ewbGenerateUrl, setEwbGenerateUrl] = useState("");
  const [ewbCancelUrl, setEwbCancelUrl] = useState("");
  const [ewbUsername, setEwbUsername] = useState("");
  const [ewbPassword, setEwbPassword] = useState("");
  const [ewbClientId, setEwbClientId] = useState("");
  const [ewbClientSecret, setEwbClientSecret] = useState("");
  const [ewbBusy, setEwbBusy] = useState(false);

  const profile = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (profile.data) setFullName(profile.data.full_name ?? "");
  }, [profile.data]);

  useEffect(() => {
    if (org) {
      setOrgName(org.name);
      setOrgIndustry(org.industry ?? "");
      setOrgCurrency(org.currency);
      setOrgTimezone(org.timezone);
      setOrgGstin(org.gstin ?? "");
      setOrgState(org.state ?? "");
      setOrgGstType(org.gst_registration_type);
    }
  }, [org]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", user.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated");
  };

  const { can } = usePermissions();
  const canEditOrg = can("settings.manage");

  const ewbStatus = useQuery({
    queryKey: ["eway-bill-credentials-status", org?.id],
    enabled: !!org?.id && canEditOrg,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eway_bill_credentials_status", {
        _org: org!.id,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  useEffect(() => {
    if (ewbStatus.data) setEwbProvider(ewbStatus.data.gsp_provider);
  }, [ewbStatus.data]);

  const saveEwayBillCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setEwbBusy(true);
    const { error } = await supabase.from("eway_bill_credentials").upsert({
      org_id: org.id,
      gsp_provider: ewbProvider,
      auth_url: ewbAuthUrl,
      generate_url: ewbGenerateUrl,
      cancel_url: ewbCancelUrl,
      gsp_username: ewbUsername || null,
      gsp_password: ewbPassword || null,
      client_id: ewbClientId || null,
      client_secret: ewbClientSecret || null,
    });
    setEwbBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("e-Way Bill credentials saved");
    setEwbUsername("");
    setEwbPassword("");
    setEwbClientId("");
    setEwbClientSecret("");
    setEwbAuthUrl("");
    setEwbGenerateUrl("");
    setEwbCancelUrl("");
    queryClient.invalidateQueries({ queryKey: ["eway-bill-credentials-status", org.id] });
  };

  const saveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    const trimmedGstin = orgGstin.trim().toUpperCase();
    if (orgGstType !== "unregistered" && trimmedGstin && !isValidGstin(trimmedGstin)) {
      toast.error("That GSTIN doesn't look valid — check the 15 characters and try again.");
      return;
    }
    setOrgBusy(true);
    const { error } = await supabase
      .from("organizations")
      .update({
        name: orgName,
        industry: orgIndustry || null,
        currency: orgCurrency,
        timezone: orgTimezone,
        gstin: trimmedGstin || null,
        state: orgState || null,
        gst_registration_type: orgGstType,
      })
      .eq("id", org.id);
    setOrgBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Business updated");
    queryClient.invalidateQueries({ queryKey: ["memberships"] });
  };

  return (
    <AppShell title="Account" description="Manage your profile details." showBackButton>
      <div className="space-y-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user?.email ?? ""} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="full-name">Full name</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {org ? (
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Business</CardTitle>
            </CardHeader>
            <CardContent>
              {canEditOrg ? (
                <form onSubmit={saveOrg} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="org-name">Business name</Label>
                    <Input
                      id="org-name"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-industry">Industry</Label>
                    <Input
                      id="org-industry"
                      value={orgIndustry}
                      onChange={(e) => setOrgIndustry(e.target.value)}
                      placeholder="FMCG distribution"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="org-currency">Currency</Label>
                      <Select value={orgCurrency} onValueChange={setOrgCurrency}>
                        <SelectTrigger id="org-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org-timezone">Timezone</Label>
                      <Select value={orgTimezone} onValueChange={setOrgTimezone}>
                        <SelectTrigger id="org-timezone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz} value={tz}>
                              {tz}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button type="submit" disabled={orgBusy}>
                    {orgBusy ? "Saving…" : "Save changes"}
                  </Button>
                </form>
              ) : (
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Name:</span> {org.name}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Industry:</span> {org.industry ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Currency:</span> {org.currency}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Timezone:</span> {org.timezone}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Only business owners and admins can edit these details.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {org ? (
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>GST profile</CardTitle>
            </CardHeader>
            <CardContent>
              {!org.gstin && orgGstType !== "unregistered" ? (
                <p className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                  No GSTIN on file yet — purchase orders can't split CGST/SGST vs. IGST correctly
                  until your business's GSTIN and state are set.
                </p>
              ) : null}
              {canEditOrg ? (
                <form onSubmit={saveOrg} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="org-gst-type">GST registration type</Label>
                    <Select value={orgGstType} onValueChange={setOrgGstType}>
                      <SelectTrigger id="org-gst-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regular">Regular</SelectItem>
                        <SelectItem value="composition">Composition scheme</SelectItem>
                        <SelectItem value="unregistered">Unregistered</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="org-gstin">GSTIN</Label>
                      <Input
                        id="org-gstin"
                        value={orgGstin}
                        onChange={(e) => setOrgGstin(e.target.value.toUpperCase())}
                        placeholder="22AAAAA0000A1Z5"
                        maxLength={15}
                        disabled={orgGstType === "unregistered"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org-state">State (for GST place of supply)</Label>
                      <Select value={orgState} onValueChange={setOrgState}>
                        <SelectTrigger id="org-state">
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
                  </div>
                  <Button type="submit" disabled={orgBusy}>
                    {orgBusy ? "Saving…" : "Save changes"}
                  </Button>
                </form>
              ) : (
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">GSTIN:</span> {org.gstin ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">State:</span> {org.state ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Registration type:</span>{" "}
                    {org.gst_registration_type}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {org && canEditOrg ? (
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>e-Way Bill (GST compliance)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                e-Way Bill generation goes through your GST Suvidha Provider (GSP) — e.g. ClearTax,
                MasterGST, Vayana, Whitebooks. Enter the base URLs and credentials your GSP issued
                you. These are stored securely and are never shown again once saved — to change
                them, re-enter and save fresh values.
              </p>
              {ewbStatus.data ? (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                  Configured: <span className="font-medium">{ewbStatus.data.gsp_provider}</span> ·
                  last updated {formatDateTime(ewbStatus.data.updated_at)}
                </p>
              ) : (
                <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                  No e-Way Bill provider configured yet — e-Way Bill generation will be unavailable
                  on sales orders, invoices, and purchase orders until this is set up.
                </p>
              )}
              <form onSubmit={saveEwayBillCredentials} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ewb-provider">GSP provider name</Label>
                  <Input
                    id="ewb-provider"
                    required
                    value={ewbProvider}
                    onChange={(e) => setEwbProvider(e.target.value)}
                    placeholder="e.g. ClearTax, MasterGST"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ewb-auth-url">Auth URL</Label>
                  <Input
                    id="ewb-auth-url"
                    type="url"
                    required
                    value={ewbAuthUrl}
                    onChange={(e) => setEwbAuthUrl(e.target.value)}
                    placeholder="https://…/authenticate"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ewb-generate-url">Generate URL</Label>
                  <Input
                    id="ewb-generate-url"
                    type="url"
                    required
                    value={ewbGenerateUrl}
                    onChange={(e) => setEwbGenerateUrl(e.target.value)}
                    placeholder="https://…/ewayapi"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ewb-cancel-url">Cancel URL</Label>
                  <Input
                    id="ewb-cancel-url"
                    type="url"
                    required
                    value={ewbCancelUrl}
                    onChange={(e) => setEwbCancelUrl(e.target.value)}
                    placeholder="https://…/ewayapi/cancel"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ewb-username">GSP username</Label>
                    <Input
                      id="ewb-username"
                      value={ewbUsername}
                      onChange={(e) => setEwbUsername(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ewb-password">GSP password</Label>
                    <Input
                      id="ewb-password"
                      type="password"
                      value={ewbPassword}
                      onChange={(e) => setEwbPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ewb-client-id">Client ID</Label>
                    <Input
                      id="ewb-client-id"
                      value={ewbClientId}
                      onChange={(e) => setEwbClientId(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ewb-client-secret">Client secret</Label>
                    <Input
                      id="ewb-client-secret"
                      type="password"
                      value={ewbClientSecret}
                      onChange={(e) => setEwbClientSecret(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={ewbBusy}>
                  {ewbBusy ? "Saving…" : ewbStatus.data ? "Update credentials" : "Save credentials"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
