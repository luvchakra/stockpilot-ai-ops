// Blog content. Curated and edited by the StockPilot team — plain data on
// purpose (no CMS/DB) since posts are authored by us, not by tenant orgs,
// and don't belong in the multi-tenant, RLS-scoped data model.

export type BlogCategory = "Industry Insights" | "Product & Tips" | "Field Notes";

export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string };

export type BlogPost = {
  slug: string;
  title: string;
  category: BlogCategory;
  excerpt: string;
  publishedAt: string; // ISO date
  readTimeMinutes: number;
  author: string;
  content: BlogBlock[];
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "hidden-cost-of-dead-stock",
    title: "The hidden cost of dead stock: what most retailers underestimate",
    category: "Industry Insights",
    excerpt:
      "Dead stock rarely shows up as a single bad decision. It's the slow accumulation of hundreds of small ones — and most businesses only notice it once the capital is already locked away.",
    publishedAt: "2026-07-14",
    readTimeMinutes: 6,
    author: "StockPilot Team",
    content: [
      {
        type: "p",
        text: "Ask most business owners how much money is tied up in stock that isn't moving, and you'll get a shrug or a guess. It's rarely a deliberate blind spot — it's just that dead stock doesn't announce itself. Nobody wakes up one morning to find a warehouse full of unsold inventory; it accumulates one slow-moving SKU at a time, hidden inside a total inventory value that still looks healthy on paper.",
      },
      {
        type: "p",
        text: "That's the first problem with dead stock: it's invisible in aggregate numbers. A warehouse worth ₹40 lakh sounds like a strength. It's a very different story if ₹6 lakh of that is sitting in 30 SKUs that haven't sold in four months. The total doesn't change, but the health of the business absolutely does.",
      },
      { type: "h2", text: "Why it accumulates" },
      {
        type: "ul",
        items: [
          "Over-ordering to hit a supplier's minimum order quantity, because the alternative — a stockout later — feels riskier in the moment.",
          "Seasonal or promotional stock that outlives the season, with no clear owner responsible for clearing it.",
          "New SKUs added faster than old ones are retired, so the catalogue quietly grows wider than demand justifies.",
          "No routine review — inventory value is checked, but inventory age almost never is.",
        ],
      },
      {
        type: "p",
        text: "Notice that none of these are irrational decisions in isolation. Each one makes sense on its own day. The damage comes from the fact that nobody is tracking the compounding effect — how many of these small, reasonable calls quietly add up.",
      },
      { type: "h2", text: "The real cost isn't just the capital" },
      {
        type: "p",
        text: "It's tempting to think of dead stock purely as money sitting on a shelf, and yes — that's capital that could have funded a better-selling line, paid down supplier credit, or simply sat in a bank account earning interest instead. But there are quieter costs too: warehouse space that could hold fast-moving stock instead, the labour cost of counting and moving inventory nobody wants, and the eventual markdown or write-off that turns a paper asset into a real loss.",
      },
      {
        type: "h2",
        text: "What actually helps",
      },
      {
        type: "ul",
        items: [
          "Track inventory age, not just inventory value — a simple 'days since last sale' view surfaces the problem before it's a crisis.",
          "Set a review cadence. Monthly is common; quarterly is the bare minimum for anything seasonal.",
          "Separate 'reorder because it sells' decisions from 'reorder because the supplier has a minimum' decisions — the second one deserves more scrutiny, not less.",
          "Have an exit plan for slow movers before they become dead stock — a bundle, a discount tier, a liquidation channel — decided in advance, not improvised under pressure.",
        ],
      },
      {
        type: "quote",
        text: "The businesses that manage this well aren't the ones with better luck. They're the ones who made inventory age a number someone actually looks at.",
      },
    ],
  },
  {
    slug: "reverse-charge-unregistered-vendors",
    title:
      "GST and unregistered vendors: the reverse charge question businesses keep getting wrong",
    category: "Industry Insights",
    excerpt:
      "Buying from a supplier who isn't GST-registered feels simple — no GSTIN, no tax on the invoice, nothing to think about. That assumption is exactly where the confusion starts.",
    publishedAt: "2026-07-28",
    readTimeMinutes: 5,
    author: "StockPilot Team",
    content: [
      {
        type: "p",
        text: "Every growing business eventually buys from someone who isn't GST-registered — a small local vendor, a one-person workshop, a supplier just under the registration threshold. The invoice that comes back has no GSTIN and no tax line, and it's easy to file that away as 'nothing to do here.' Sometimes that's correct. Sometimes it isn't, and the difference matters more than it looks.",
      },
      { type: "h2", text: "What reverse charge actually means" },
      {
        type: "p",
        text: "Under GST, tax is normally collected by the seller and passed on to the government. Reverse charge flips that: for specific, notified categories of supply, the buyer is the one liable to pay GST directly, self-invoicing the transaction and depositing the tax themselves — regardless of what the supplier's own invoice says.",
      },
      {
        type: "p",
        text: "This is where the confusion sets in. Reverse charge doesn't apply to every purchase from an unregistered dealer — it applies to specific notified categories of goods and services (and, in certain cases, to a registered person receiving a supply from an unregistered person). The blanket rule that once existed for all unregistered purchases has been narrowed over time; treating every unregistered vendor purchase the same way — either 'always reverse charge' or 'never reverse charge' — is how mistakes happen in both directions.",
      },
      { type: "h2", text: "Why this trips businesses up" },
      {
        type: "ul",
        items: [
          "It doesn't feel like a tax event. No GST appears anywhere on the vendor's invoice, so the transaction looks tax-free rather than tax-shifted.",
          "It depends on what's notified, not on the vendor's status alone — the same unregistered vendor can trigger reverse charge for one type of supply and not another.",
          "Missing it isn't a rounding error. The buyer's own GST liability under reverse charge doesn't disappear just because it wasn't self-invoiced at the time — it surfaces later as unpaid tax.",
        ],
      },
      { type: "h2", text: "What to actually do about it" },
      {
        type: "ul",
        items: [
          "Flag every unregistered-vendor purchase for a second look rather than assuming it's automatically tax-free.",
          "Check the current notified list of reverse-charge categories against what was actually purchased — this changes over time, so don't rely on last year's understanding.",
          "When reverse charge applies, self-invoice it properly and keep it visible in your own records, not just buried in a vendor file with no tax line.",
          "Talk to your GST practitioner before assuming either 'always' or 'never' for unregistered-vendor purchases — the specifics decide it, not a general rule.",
        ],
      },
      {
        type: "p",
        text: "None of this is a reason to avoid smaller, unregistered vendors — plenty of good suppliers fall into that category, especially early on. It's a reason to treat 'no GSTIN on the invoice' as a prompt to check, not a signal that there's nothing to check.",
      },
    ],
  },
  {
    slug: "reorder-point-shouldnt-be-a-guess",
    title: "Why your reorder point shouldn't be a guess",
    category: "Product & Tips",
    excerpt:
      "\"We usually reorder around 50 units\" is a habit, not a calculation. Here's what a real reorder point accounts for — and what happens once it's actually tracked instead of remembered.",
    publishedAt: "2026-08-05",
    readTimeMinutes: 5,
    author: "StockPilot Team",
    content: [
      {
        type: "p",
        text: "Ask most small business owners how they decide when to reorder a product, and the honest answer is usually some version of 'we've just always ordered around then.' It's not a bad instinct — years of running a business builds real intuition — but intuition doesn't scale, and it definitely doesn't transfer to a new hire, a second warehouse, or a product that's only been on the shelf for two months.",
      },
      { type: "h2", text: "What a reorder point is actually made of" },
      {
        type: "p",
        text: "A proper reorder point isn't a round number someone picked. It's the answer to a specific question: how much stock do I need on hand to survive from the moment I place an order until the new stock physically arrives, without running out? That depends on two things that are rarely written down anywhere: how fast the product actually sells, and how long the supplier actually takes to deliver — not how long they promised, but how long they've actually taken, on average, including the slow months.",
      },
      {
        type: "p",
        text: "Get either number wrong and the reorder point is wrong in a specific, predictable direction. Underestimate the lead time and you'll stock out before the new order arrives. Underestimate demand and you'll reorder too late even with the right lead time. Most 'we usually reorder around 50' numbers were set once, based on whatever was true at the time, and never revisited as the business — or the supplier's reliability — changed.",
      },
      { type: "h2", text: "What changes when it's tracked instead of remembered" },
      {
        type: "ul",
        items: [
          "Low-stock alerts fire from an actual threshold per product, not from someone happening to notice the shelf looks empty.",
          "New team members can make the same reorder decisions a five-year veteran would, because the threshold isn't in anyone's head.",
          "A product with a genuinely unreliable supplier can carry a larger buffer than one with a fast, dependable one — instead of every product getting the same rough buffer.",
          "Reviewing reorder points becomes a five-minute task instead of a debate about what 'usually' means.",
        ],
      },
      {
        type: "p",
        text: "This is one of the more boring-sounding fixes available to a growing business, and also one of the highest-leverage ones — it's the difference between reacting to stockouts and never seeing one in the first place. StockPilot computes this from every product's own movement history and turns it into a live low-stock alert the moment stock crosses the threshold, instead of waiting for someone to notice the shelf.",
      },
    ],
  },
  {
    slug: "spreadsheet-chaos-to-one-source-of-truth",
    title: "From spreadsheet chaos to one source of truth",
    category: "Product & Tips",
    excerpt:
      "Most purchase order processes don't fail because of one bad decision — they fail because the same information lives in five places that quietly disagree with each other.",
    publishedAt: "2026-08-18",
    readTimeMinutes: 6,
    author: "StockPilot Team",
    content: [
      {
        type: "p",
        text: "A familiar pattern in growing businesses: the purchase order started life as a WhatsApp message to a supplier, got copied into a spreadsheet for the accountant, generated a separate note for the warehouse team to expect the delivery, and ended up recorded a fourth time when the invoice finally arrived for payment. Four places, one transaction, and no guarantee any of them agree with each other by the time the stock actually shows up.",
      },
      {
        type: "p",
        text: "None of this happens because anyone is careless. It happens because a purchase order genuinely touches several different concerns — what was ordered, what it will cost, when it's expected, what actually arrived, and what's now owed — and without a single system that all of those concerns write into, each one ends up living wherever was most convenient at the time.",
      },
      { type: "h2", text: "Where it actually breaks" },
      {
        type: "ul",
        items: [
          "Partial deliveries — the spreadsheet says 100 units ordered, the warehouse received 60, and updating the original PO to reflect that gets forgotten more often than it gets done.",
          "Price changes — a supplier quotes a new rate mid-relationship, and it updates in the accountant's file but not in whatever the warehouse team is looking at.",
          "Status visibility — 'has this been sent to the supplier yet' becomes a question that requires actually asking someone, because there's no single place that answer lives.",
          "Tax on the purchase — computed once, by hand, and rarely revisited even when a rate or a supplier's location changes.",
        ],
      },
      { type: "h2", text: "What 'one source of truth' actually looks like" },
      {
        type: "p",
        text: "It's not about the fanciest software — it's about a purchase order having exactly one home, from the moment it's drafted through approval, sending, partial or full receiving, and finally closing. Everyone who needs to know its status looks at the same record instead of a copy of a copy.",
      },
      {
        type: "ul",
        items: [
          "One place a PO's status actually lives — draft, sent, partially received, received, closed — visible to everyone who needs it, at the same time.",
          "Receiving updates the same record the order was created in, including partial shipments, instead of a separate note that has to be reconciled later.",
          "Tax computed automatically and consistently, not re-typed by whoever happens to be doing it that week.",
          "A history that survives staff turnover — the next person doesn't have to reverse-engineer what happened from four different files.",
        ],
      },
      {
        type: "p",
        text: "This is, not coincidentally, exactly the shape of StockPilot's Purchase Orders module — a single record per order that moves through its real lifecycle, with receiving, tax and stock updates all writing to the same place instead of five different ones.",
      },
    ],
  },
  {
    slug: "multi-warehouse-without-the-headache",
    title: "Multi-warehouse without the headache: a practical playbook",
    category: "Field Notes",
    excerpt:
      "Opening a second location changes almost everything about how inventory decisions get made — and most of the problems it creates are avoidable if you see them coming.",
    publishedAt: "2026-08-25",
    readTimeMinutes: 7,
    author: "StockPilot Team",
    content: [
      {
        type: "p",
        text: "A single warehouse is forgiving. Even a messy process mostly works, because there's only one place stock can be, and one team who knows where everything is. The second warehouse changes that arithmetic completely — not because the second location is harder to run, but because now every inventory decision has to account for two places at once, and the informal knowledge that made the first location work doesn't automatically transfer.",
      },
      { type: "h2", text: "The problems that show up almost immediately" },
      {
        type: "ul",
        items: [
          "One location runs low while the other is sitting on excess of the exact same SKU, because nobody has visibility across both at the same time.",
          "A customer order gets fulfilled from the 'wrong' warehouse — further away, higher shipping cost — simply because that's the one someone happened to check first.",
          "Reorder decisions get made per-warehouse instead of for the business as a whole, leading to duplicate purchase orders when a transfer would have solved it for free.",
          "Stock counts and audits take twice as long and are twice as easy to get subtly wrong, because now there are two physical realities to reconcile against two sets of records.",
        ],
      },
      { type: "h2", text: "What actually works" },
      {
        type: "p",
        text: "The businesses that scale to multiple locations smoothly tend to get a few specific things right early, before the second warehouse is even fully stocked.",
      },
      {
        type: "ul",
        items: [
          "A single, real-time view of stock across every location — not two spreadsheets someone manually compares once a week.",
          "A default rule for which warehouse fulfils which orders (usually proximity or cost), with an easy override rather than a case-by-case decision every time.",
          "A proper transfer workflow — not just an informal 'send some over' — so a transfer is tracked the same way a sale or a purchase is, with a before-and-after on both sides.",
          "Reorder points and forecasting done at the network level first, then broken down by location — so a purchase decision considers the whole business, not just whichever warehouse someone happens to be looking at.",
        ],
      },
      {
        type: "quote",
        text: "The second warehouse rarely fails because of the new location. It fails because the systems built for one location quietly stop being enough for two.",
      },
      {
        type: "p",
        text: "None of this requires waiting until you're a large operation to get right — the earlier a proper multi-warehouse view exists, the less painful the third, fourth and fifth locations become.",
      },
    ],
  },
  {
    slug: "real-cost-of-a-stockout",
    title: "The real cost of a stockout — and why most businesses undercount it",
    category: "Field Notes",
    excerpt:
      "A stockout looks like one missed sale. In practice, the missed sale is usually the smallest part of what it actually costs.",
    publishedAt: "2026-08-30",
    readTimeMinutes: 5,
    author: "StockPilot Team",
    content: [
      {
        type: "p",
        text: "When a product runs out, the obvious cost is easy to picture: a customer wanted to buy it, couldn't, and the sale didn't happen. That's real, but for most businesses it's also the smallest piece of what a stockout actually costs — the rest of it just doesn't show up on any single line of the accounts, so it's rarely counted at all.",
      },
      { type: "h2", text: "What's easy to miss" },
      {
        type: "ul",
        items: [
          "The customer who doesn't wait — on a marketplace or storefront especially, a stockout often just means the sale goes to a competitor instantly, not later.",
          "The rush order placed to fix it — expedited shipping, a smaller minimum-order-friendly supplier, or a rate premium paid purely because there was no time to shop around.",
          "Marketplace ranking and visibility — several platforms quietly penalise listings with a history of going out of stock, so the cost outlasts the stockout itself.",
          "Staff time spent firefighting — chasing suppliers, apologising to customers, and manually re-sequencing what should have been a routine reorder.",
          "Trust, for repeat customers specifically — a business that's reliably in stock earns a kind of loyalty that's hard to win back once it's been dented.",
        ],
      },
      { type: "h2", text: "Why it stays undercounted" },
      {
        type: "p",
        text: "Most accounting simply has nowhere to put these costs. A missed sale is invisible by definition — there's no transaction to record. A rush order looks, in the books, just like a slightly more expensive purchase, not a symptom of a planning failure. So the true cost of a stockout ends up scattered across categories that never get added back together, and the business only feels it as a vague sense that margins are tighter than they should be.",
      },
      { type: "h2", text: "The fix is upstream, not downstream" },
      {
        type: "p",
        text: "Because the costs are so spread out, trying to fix them after a stockout happens is almost always more expensive than preventing it. That points the effort in one direction: real, per-product reorder points based on actual sales velocity and actual supplier lead times, checked continuously rather than at whatever interval someone remembers to do it — so the reorder happens before the shelf is empty, not after.",
      },
      {
        type: "p",
        text: "It's a less exciting fix than it sounds, and that's exactly why it works — the goal isn't a clever save at the last minute, it's making sure there's never a last minute to save in the first place.",
      },
    ],
  },
];

export function getBlogPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

export function getRelatedPosts(slug: string, limit = 3): BlogPost[] {
  const current = getBlogPostBySlug(slug);
  const others = BLOG_POSTS.filter((p) => p.slug !== slug);
  if (!current) return others.slice(0, limit);
  const sameCategory = others.filter((p) => p.category === current.category);
  const rest = others.filter((p) => p.category !== current.category);
  return [...sameCategory, ...rest].slice(0, limit);
}
