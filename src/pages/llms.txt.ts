import type { APIRoute } from "astro";
import { site, installCommand, AVAILABLE } from "../config/site";

/**
 * /llms.txt — https://llmstxt.org/
 *
 * Shipped with clear eyes about what it is and is not.
 *
 * It buys nothing in Google. Google has said so directly, and Ahrefs' May 2026
 * server-log study across 137,210 domains found 97% of published llms.txt files
 * received zero requests, with AI *retrieval* bots accounting for ~1% of the
 * traffic the remainder saw.
 *
 * It is here for one reason: in that same dataset, `Claude-Code` was the second
 * most active named AI fetcher. thalamus's audience is people running coding
 * agents, and they will paste this URL into one. That makes this a developer-
 * experience surface, not an SEO tactic.
 *
 * Every link below resolves. Nothing points at a page that does not exist yet —
 * AI crawlers already waste roughly a third of their fetches on 404s, and
 * pointing them at more is how you get deprioritised.
 */
export const prerender = true;

const soon = (key: keyof typeof AVAILABLE) => (AVAILABLE[key] ? "" : " (not yet public)");

const body = `# thalamus

> thalamus is an open-source, self-hosted control plane and memory layer for
> agentic work. It sits above coding agents — Claude Code, Codex, opencode,
> local models — as a meta-harness: one memory that survives sessions and
> engine swaps, one trust gate that classifies every action before it runs,
> and durable jobs that outlive restarts. Engines are replaceable adapters,
> not foundations. ${site.license} licensed. Free. Pre-release.

thalamus answers the question "who owns state when you run more than one coding
agent". Memory, job history, approvals and the audit log live in the control
plane rather than inside any single vendor's session. Reversible, low-stakes
work executes and logs itself; anything irreversible, external or expensive is
routed back to a human through the trust gate. Web, desktop, mobile and CLI are
clients of one server contract, not separate products.

The name is literal: the thalamus is the brain's relay and routing station.
This is not the intelligence — it is what routes, gates and remembers on its
behalf.

## Facts

- Name: thalamus
- Site: ${site.url}
- Licence: ${site.license} (${site.licenseUrl})
- Price: free. Self-hosted, so you pay only for your own compute and model tokens.
- Status: pre-release (v0). Interfaces, contracts and storage layouts can still change.
- Runtime: Node.js / TypeScript. Linux and macOS.
- Install: \`${installCommand}\`${soon("install")}
- Hosting model: self-hosted only. No account, no tenancy, no hosted service.
- Category: AI agent orchestration, coding-agent control plane, agent memory layer, self-hosted developer infrastructure.

## Kernel

The kernel is deliberately small — ten nouns, and an eleventh needs a proposal:
authority, action log, trust gate, jobs, memory port, resource registry, RPC
registry, plugin lifecycle, clock, settlement receipts.

Everything else is a plugin (surfaces, sources, skills, harnesses) or a driver
(memory, model, transport, storage). Both are replaceable.

## Autonomy model

- Own infrastructure, reversible: the agent acts, then logs.
- Risky, external or spend-bearing: the agent proposes; a human approves before it runs.
- Client-facing work: draft only; a human ships it.
- Outbound email: draft only, never sent. No exceptions.

## Pages

- [thalamus — the control plane and memory for agentic work](${site.url}/): what it is, what runs overnight, and how work is routed.
- [Something is always on](${site.url}/#alive): how signals route through the relay to whichever engine is free.
- [Starts empty, grows into anything](${site.url}/#plugins): the plugin model.
- [Under everything, a kernel](${site.url}/#architecture): the layer stack and the ten kernel nouns.
- [The honest bit](${site.url}/#honest): what is and is not true of v0 today.

## Optional

- [Waitlist](${site.url}/#waitlist): where to hear when there is a build worth self-hosting.
- [Source repository](${site.repo})${soon("github")}
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Useful to an agent, not useful in a search index.
      "X-Robots-Tag": "noindex",
    },
  });
