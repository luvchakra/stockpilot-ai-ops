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
  const { org, role } = useCurrentOrg();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgIndustry, setOrgIndustry] = useState("");
  const [orgBusy, setOrgBusy] = useState(false);

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

  const canEditOrg = role === "owner" || role === "admin";

  const saveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setOrgBusy(true);
    const { error } = await supabase
      .from("organizations")
      .update({ name: orgName, industry: orgIndustry || null })
      .eq("id", org.id);
    setOrgBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Workspace updated");
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
              <CardTitle>Workspace</CardTitle>
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    Only workspace owners and admins can edit these details.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
