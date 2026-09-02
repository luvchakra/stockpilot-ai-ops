import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BLOG_POSTS, type BlogCategory } from "@/content/blog-posts";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/blog")({
  head: () => ({
    meta: [
      { title: "Blog — StockPilot" },
      {
        name: "description",
        content:
          "Inventory, procurement and GST insights for growing Indian businesses — plus a look at how StockPilot handles the same problems.",
      },
      { property: "og:title", content: "StockPilot Blog" },
      {
        property: "og:description",
        content: "Inventory, procurement and GST insights for growing Indian businesses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BlogIndex,
});

const CATEGORY_STYLES: Record<BlogCategory, string> = {
  "Industry Insights": "border-primary/30 bg-primary/10 text-primary",
  "Product & Tips": "border-signal/30 bg-signal/10 text-signal",
  "Field Notes": "border-warn/30 bg-warn/10 text-warn",
};

function BlogIndex() {
  const posts = [...BLOG_POSTS].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-4" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">StockPilot</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <Link to="/" className="transition-colors hover:text-foreground">
              Home
            </Link>
            <Link to="/blog" className="font-medium text-foreground">
              Blog
            </Link>
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

      <main className="mx-auto max-w-6xl px-5 py-16">
        <div className="max-w-2xl">
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            StockPilot Blog
          </Badge>
          <h1 className="mt-4 text-4xl font-bold text-balance md:text-5xl">
            Inventory, procurement and running a business that doesn't run out.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Practical write-ups on the problems every growing business runs into — dead stock, GST
            edge cases, multi-warehouse operations — and occasionally a look at how StockPilot
            handles the same problems.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              to="/blog/$slug"
              params={{ slug: post.slug }}
              className="panel lift group flex flex-col p-6"
            >
              <Badge variant="outline" className={CATEGORY_STYLES[post.category]}>
                {post.category}
              </Badge>
              <h2 className="mt-4 text-lg font-semibold text-balance transition-colors group-hover:text-primary">
                {post.title}
              </h2>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">{post.excerpt}</p>
              <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDate(post.publishedAt)}</span>
                <span>{post.readTimeMinutes} min read</span>
              </div>
            </Link>
          ))}
        </div>
      </main>

      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="size-3.5" />
            </span>
            <span className="font-display font-semibold text-foreground">StockPilot</span>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1 font-medium text-foreground hover:underline"
          >
            Back to home <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
