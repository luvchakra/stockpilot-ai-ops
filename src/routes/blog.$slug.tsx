import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShareButtons } from "@/components/share-buttons";
import {
  getBlogPostBySlug,
  getRelatedPosts,
  type BlogBlock,
  type BlogCategory,
} from "@/content/blog-posts";
import { formatDate } from "@/lib/format";

const SITE_URL = "https://stockpilot-ai-ops.vercel.app";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getBlogPostBySlug(params.slug);
    if (!post) throw notFound();
    return post;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} — StockPilot Blog` },
          { name: "description", content: loaderData.excerpt },
          { property: "og:title", content: loaderData.title },
          { property: "og:description", content: loaderData.excerpt },
          { property: "og:type", content: "article" },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : [],
  }),
  component: BlogPostPage,
});

const CATEGORY_STYLES: Record<BlogCategory, string> = {
  "Industry Insights": "border-primary/30 bg-primary/10 text-primary",
  "Product & Tips": "border-signal/30 bg-signal/10 text-signal",
  "Field Notes": "border-warn/30 bg-warn/10 text-warn",
};

function Block({ block }: { block: BlogBlock }) {
  switch (block.type) {
    case "h2":
      return <h2 className="mt-8 text-2xl font-bold text-balance">{block.text}</h2>;
    case "ul":
      return (
        <ul className="mt-4 space-y-2">
          {block.items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-muted-foreground">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="mt-6 border-l-2 border-primary pl-4 text-lg text-foreground italic">
          {block.text}
        </blockquote>
      );
    case "p":
    default:
      return <p className="mt-4 leading-relaxed text-muted-foreground">{block.text}</p>;
  }
}

function BlogPostPage() {
  const post = Route.useLoaderData();
  const related = getRelatedPosts(post.slug);
  const url = `${SITE_URL}/blog/${post.slug}`;

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
            <Link to="/blog" className="transition-colors hover:text-foreground">
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

      <main className="mx-auto max-w-3xl px-5 py-16">
        <Link
          to="/blog"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All articles
        </Link>

        <Badge variant="outline" className={`mt-6 ${CATEGORY_STYLES[post.category]}`}>
          {post.category}
        </Badge>
        <h1 className="mt-4 text-3xl font-bold text-balance md:text-4xl">{post.title}</h1>
        <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
          <span>{post.author}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDate(post.publishedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{post.readTimeMinutes} min read</span>
        </div>

        <ShareButtons url={url} title={post.title} className="mt-6" />

        <article className="mt-8">
          {post.content.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </article>

        <div className="panel mt-12 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">See this handled automatically</p>
            <p className="mt-1 text-sm text-muted-foreground">
              StockPilot turns the ideas above into live alerts, purchase orders and GST reports —
              free to try, no card required.
            </p>
          </div>
          <Button asChild className="shrink-0">
            <Link to="/auth" search={{ mode: "signup" }}>
              Start Free <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <ShareButtons url={url} title={post.title} className="mt-10 border-t border-border pt-8" />

        {related.length > 0 ? (
          <div className="mt-14">
            <h2 className="text-lg font-semibold">More from the blog</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to="/blog/$slug"
                  params={{ slug: r.slug }}
                  className="panel lift p-4 text-sm font-medium hover:text-primary"
                >
                  {r.title}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
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
