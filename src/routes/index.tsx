import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  Cpu,
  Lock,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Truck,
  Warehouse,
} from "lucide-react";
import heroShot from "@/assets/dashboard-hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StockPilot — Inventory That Thinks Ahead" },
      {
        name: "description",
        content:
          "StockPilot unifies inventory, purchasing, warehouses, sales channels and GST-ready finance in one AI-powered platform built for growing Indian businesses.",
      },
      { property: "og:title", content: "StockPilot — Inventory That Thinks Ahead" },
      {
        property: "og:description",
        content:
          "Forecast stockouts, automate reordering and sync every sales channel from a single intelligent inventory platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const ecosystem = [
  "E-commerce",
  "Marketplaces",
  "Accounting",
  "Payments",
  "Shipping",
  "Invoicing",
  "POS",
  "Open API",
];

const problems = [
  "Spreadsheets that go stale the moment a sale happens",
  "Stock counts that never match the shelf",
  "Purchase orders placed on gut feel",
  "Warehouses that hoard what another location needs",
  "Marketplace listings overselling what you don't have",
  "Capital quietly locked in dead stock",
];

const pillars = [
  {
    icon: Boxes,
    title: "Inventory",
    body: "On hand, reserved, incoming, damaged and in-transit tracked per warehouse with an immutable movement ledger behind every change.",
  },
  {
    icon: Truck,
    title: "Procurement",
    body: "Suppliers, lead times, MOQs and purchase orders from draft to receiving — including partial, damaged and short shipments.",
  },
  {
    icon: RefreshCw,
    title: "Omnichannel",
    body: "A connector framework for storefronts, marketplaces and POS with mapping, webhooks and conflict-safe stock sync.",
  },
  {
    icon: BarChart3,
    title: "Finance",
    body: "GST-ready invoicing with HSN/SAC, CGST/SGST/IGST, credit and debit notes, payments and accounting sync.",
  },
  {
    icon: Cpu,
    title: "Intelligence",
    body: "Demand forecasting, reorder maths, transfer suggestions and supplier scoring — computed on data, explained in plain language.",
  },
];

const aiExamples = [
  {
    tone: "critical" as const,
    text: "You will run out of SKU-104 in 8 days. Reorder 340 units today to cover the 12-day supplier lead time.",
  },
  {
    tone: "signal" as const,
    text: "Transfer 120 units from Mumbai to Bengaluru instead of placing a new purchase order. Saves ₹86,000.",
  },
  {
    tone: "warn" as const,
    text: "₹2.4L is tied up in slow-moving inventory across 18 SKUs with no sales in 90 days.",
  },
];

const scanning = [
  { icon: ScanLine, label: "Receive stock" },
  { icon: QrCode, label: "Cycle count" },
  { icon: Warehouse, label: "Transfer" },
  { icon: Boxes, label: "Pick & pack" },
];

const security = [
  {
    title: "Tenant isolation",
    body: "Every row is scoped by organization and enforced with PostgreSQL row-level security — never frontend filtering alone.",
  },
  {
    title: "Granular permissions",
    body: "module.action permissions behind seven default roles, extensible into custom roles per organization.",
  },
  {
    title: "Full audit trail",
    body: "Adjustments, approvals, integration events and AI-executed actions are recorded with actor, before and after state.",
  },
  {
    title: "Secrets stay server-side",
    body: "Integration tokens are stored encrypted and never reach the browser.",
  },
];

const plans = [
  {
    name: "Launch",
    price: "₹1,499",
    note: "per month",
    blurb: "For single-location brands finding their rhythm.",
    features: ["Up to 500 SKUs", "1 warehouse", "3 users", "2 sales channels", "Core forecasting"],
    cta: "Start Free",
    featured: false,
  },
  {
    name: "Growth",
    price: "₹4,999",
    note: "per month",
    blurb: "For multi-channel teams scaling operations.",
    features: [
      "Up to 5,000 SKUs",
      "5 warehouses",
      "15 users",
      "All connectors",
      "AI Command Center",
      "Accounting sync",
    ],
    cta: "Start Free",
    featured: true,
  },
  {
    name: "Scale",
    price: "Custom",
    note: "annual",
    blurb: "For distributors and multi-location operators.",
    features: [
      "Unlimited SKUs",
      "Unlimited warehouses",
      "Custom roles",
      "Serial & batch tracking",
      "Dedicated support",
    ],
    cta: "Book a Demo",
    featured: false,
  },
];

const faqs = [
  {
    q: "Is StockPilot built for GST compliance?",
    a: "Yes. GSTIN, HSN/SAC, CGST, SGST, IGST and UTGST are modelled in a configurable tax layer, so rates are never hard-coded and international expansion stays possible.",
  },
  {
    q: "Can my team use phones on the warehouse floor?",
    a: "Scanning runs in the browser on any device camera. Receiving, counting, transfers, picking and returns each have a dedicated scan-first flow.",
  },
  {
    q: "How does the AI avoid making things up?",
    a: "Forecasting and reorder quantities are computed from structured sales, lead-time and stock data. The language model only explains results and drafts actions, which always require your confirmation before execution.",
  },
  {
    q: "What happens to my existing data?",
    a: "Import products and opening stock via CSV or Excel during onboarding, or connect a sales channel and let SKU matching map your catalogue.",
  },
  {
    q: "Can one person manage several businesses?",
    a: "Yes. A user can belong to multiple organizations and switch between them; context and permissions reload securely on every switch.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#top" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-4" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">StockPilot</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#product" className="transition-colors hover:text-foreground">
              Product
            </a>
            <a href="#intelligence" className="transition-colors hover:text-foreground">
              Intelligence
            </a>
            <a href="#integrations" className="transition-colors hover:text-foreground">
              Integrations
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <Link to="/auth" search={{ mode: "signin" }}>
                Log in
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/auth" search={{ mode: "signup" }}>
                Start Free
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="hero-glow relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-5 pt-20 pb-16 text-center md:pt-28">
            <Badge
              variant="outline"
              className="mb-6 border-primary/30 bg-primary/10 text-primary"
            >
              <Sparkles className="mr-1 size-3" /> Built India-first, GST-ready
            </Badge>
            <h1 className="mx-auto max-w-3xl text-balance text-4xl leading-[1.05] font-bold md:text-6xl">
              Inventory that <span className="text-signal-gradient">thinks ahead.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
              StockPilot helps growing businesses manage inventory, purchasing, warehouses, sales
              channels and finances from one intelligent platform.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="w-full sm:w-auto" asChild>
                <Link to="/auth" search={{ mode: "signup" }}>
                  Start Free <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Book a Demo
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No card required · 14-day trial · Import your catalogue in minutes
            </p>

            <div className="glow relative mt-14 overflow-hidden rounded-2xl border border-border">
              <img
                src={heroShot}
                alt="StockPilot dashboard showing inventory value, stock risk trends and low-stock alerts"
                width={1264}
                height={848}
                className="w-full"
              />
            </div>
          </div>
        </section>

        {/* Ecosystem */}
        <section className="border-y border-border/60 bg-surface/40 py-8">
          <div className="mx-auto max-w-6xl px-5">
            <p className="text-center text-xs tracking-[0.2em] text-muted-foreground uppercase">
              Designed to connect with your stack
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {ecosystem.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-border bg-surface-2 px-4 py-1.5 text-sm text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Problem */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-3xl font-bold text-balance md:text-4xl">
                Your inventory is spread everywhere.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Across warehouses, marketplaces, a WhatsApp order here, a returned parcel there. By
                the time the numbers are reconciled, the decision window has already closed.
              </p>
            </div>
            <ul className="grid gap-3">
              {problems.map((p) => (
                <li
                  key={p}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                  <span className="text-muted-foreground">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Product overview */}
        <section id="product" className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-2xl text-3xl font-bold text-balance md:text-4xl">
            One platform, five operating layers.
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Every module writes to the same ledger, so what you see in finance matches what is on
            the shelf.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pillars.map(({ icon: Icon, title, body }) => (
              <article key={title} className="panel lift p-6">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </article>
            ))}
            <article className="panel lift flex flex-col justify-between bg-primary/10 p-6">
              <div>
                <h3 className="text-lg font-semibold">Scan-first operations</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  EAN, UPC, Code 128, Code 39 and QR — mapped to the exact variant, from any phone.
                </p>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {scanning.map(({ icon: Icon, label }) => (
                  <span
                    key={label}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"
                  >
                    <Icon className="size-3.5 text-primary" />
                    {label}
                  </span>
                ))}
              </div>
            </article>
          </div>
        </section>

        {/* AI */}
        <section id="intelligence" className="border-y border-border/60 bg-surface/40 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <Badge variant="outline" className="border-primary/30 text-primary">
                  AI Command Center
                </Badge>
                <h2 className="mt-4 text-3xl font-bold text-balance md:text-4xl">
                  Don't just see your stock. Know what to do next.
                </h2>
                <p className="mt-4 text-muted-foreground">
                  Forecasts run on your real sales velocity, lead times and seasonality. StockPilot
                  turns those numbers into a short list of decisions — and never executes a
                  financially consequential action without your confirmation.
                </p>
                <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                  {[
                    "Stockout dates with confidence ranges",
                    "Reorder quantity, adjusted for MOQ and pack size",
                    "Transfer instead of purchase suggestions",
                    "Dead stock and tied-up capital detection",
                    "Supplier fill-rate and delay scoring",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel lift p-5">
                <div className="flex items-center gap-2 border-b border-border pb-3 text-sm text-muted-foreground">
                  <Sparkles className="size-4 text-primary" />
                  Ask StockPilot
                </div>
                <div className="mt-4 space-y-3">
                  {aiExamples.map((ex) => (
                    <p
                      key={ex.text}
                      className={`rounded-xl border px-4 py-3 text-sm ${
                        ex.tone === "critical"
                          ? "border-destructive/40 bg-destructive/10"
                          : ex.tone === "warn"
                            ? "border-warn/40 bg-warn/10"
                            : "border-primary/40 bg-primary/10"
                      }`}
                    >
                      {ex.text}
                    </p>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
                  “What should I purchase this week?”
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section id="integrations" className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-bold text-balance md:text-4xl">
            A connector framework, not a fixed list.
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Storefronts, marketplaces, POS, accounting and shipping plug into the same normalization
            layer with queued syncs, idempotency keys and retry with backoff.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Sales channels",
                items: ["Storefront platforms", "Indian marketplaces", "POS terminals", "Custom API"],
              },
              {
                title: "Finance",
                items: ["Tally-style exports", "Cloud accounting APIs", "Payment records", "Tax mapping"],
              },
              {
                title: "Sync controls",
                items: ["Pull, push or bidirectional", "Source-of-truth rules", "Webhook event log", "Failure alerts"],
              },
            ].map((group) => (
              <div key={group.title} className="panel p-6">
                <h3 className="text-base font-semibold">{group.title}</h3>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {group.items.map((i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Security */}
        <section className="border-y border-border/60 bg-surface/40 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-6 text-primary" />
              <h2 className="text-3xl font-bold md:text-4xl">Isolated by design</h2>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {security.map((s) => (
                <div key={s.title} className="panel p-6">
                  <div className="flex items-center gap-2">
                    <Lock className="size-4 text-primary" />
                    <h3 className="font-semibold">{s.title}</h3>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-5 py-20">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Pricing that scales with your SKUs</h2>
            <p className="mt-3 text-muted-foreground">
              All plans include scanning, multi-warehouse and GST invoicing.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`panel flex flex-col p-6 ${plan.featured ? "glow border-primary/40" : ""}`}
              >
                {plan.featured && (
                  <Badge className="mb-3 w-fit">Most popular</Badge>
                )}
                <h3 className="font-display text-lg font-semibold">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.blurb}</p>
                <p className="mt-5 flex items-baseline gap-1">
                  <span className="font-display text-3xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.note}</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-muted-foreground">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-6"
                  variant={plan.featured ? "default" : "outline"}
                  asChild={plan.cta === "Start Free"}
                >
                  {plan.cta === "Start Free" ? (
                    <Link to="/auth" search={{ mode: "signup" }}>
                      {plan.cta}
                    </Link>
                  ) : (
                    plan.cta
                  )}
                </Button>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-5 py-20">
          <h2 className="text-3xl font-bold md:text-4xl">Questions, answered</h2>
          <Accordion type="single" collapsible className="mt-6">
            {faqs.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Final CTA */}
        <section className="hero-glow border-t border-border/60">
          <div className="mx-auto max-w-3xl px-5 py-24 text-center">
            <h2 className="text-3xl font-bold text-balance md:text-5xl">
              Stop counting. Start deciding.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Bring every warehouse, channel and supplier into one view — and let StockPilot tell you
              what needs attention today.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="w-full sm:w-auto" asChild>
                <Link to="/auth" search={{ mode: "signup" }}>
                  Start Free <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Book a Demo
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="size-3.5" />
            </span>
            <span className="font-display font-semibold text-foreground">StockPilot</span>
          </div>
          <p>© {new Date().getFullYear()} StockPilot. Built for growing businesses.</p>
        </div>
      </footer>
    </div>
  );
}
