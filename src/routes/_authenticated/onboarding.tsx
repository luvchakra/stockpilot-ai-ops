import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Boxes } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Create your workspace — StockPilot" },
      {
        name: "description",
        content:
          "Set up your StockPilot organisation and first warehouse to start tracking stock, suppliers and procurement.",
      },
      { property: "og:title", content: "Create your StockPilot workspace" },
      {
        property: "og:description",
        content: "Set up your organisation and first warehouse in StockPilot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Onboarding,
});

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  );
}

function Onboarding() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [warehouse, setWarehouse] = useState("Main Warehouse");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not signed in");

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .insert({
          name,
          slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
          industry: industry || null,
          created_by: user.user.id,
        })
        .select()
        .single();
      if (orgError) throw orgError;

      const { error: whError } = await supabase.from("warehouses").insert({
        org_id: org.id,
        name: warehouse,
        code: "WH-01",
        city: city || null,
        country: "India",
      });
      if (whError) throw whError;

      window.localStorage.setItem("stockpilot.org", org.id);
      toast.success("Workspace ready");
      navigate({ to: "/dashboard" });
    } catch (err) {
      // Supabase query errors (e.g. an RLS rejection) are plain
      // { message, details, hint, code } objects, not Error instances,
      // so `err instanceof Error` alone would hide their real message
      // behind the generic fallback below.
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
            ? (err as { message: string }).message
            : "Could not create workspace";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="hero-glow flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-2">
          <Boxes className="size-6 text-signal" />
          <span className="font-display text-xl font-bold tracking-tight">StockPilot</span>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Create your workspace
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every workspace is isolated at the database level. You can invite your team later.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org">Business name</Label>
              <Input
                id="org"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vaidya Traders Pvt Ltd"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="FMCG distribution"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wh">First warehouse</Label>
                <Input
                  id="wh"
                  required
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Pune"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Setting up…" : "Create workspace"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
