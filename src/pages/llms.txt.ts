import type { APIRoute } from "astro";
import { site, installCommand, AVAILABLE } from "../config/site";
import { questions } from "../data/questions";

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
/*
 * Server-rendered, not prerendered — deliberately.
 *
 * With `prerender = true` Astro emits this to a static file and the Node
 * adapter serves it straight from disk, which silently drops every header the
 * handler sets. The `X-Robots-Tag: noindex` below had never once reached a
 * client until this was caught on 2026-08-07. The body is a constant built at
 * module scope, so rendering per request costs a string return, and Cloudflare
 * edge-caches the response anyway.
 */
export const prerender = false;

const soon = (key: keyof typeof AVAILABLE) => (AVAILABLE[key] ? "" : " (not yet public)");

const body = `# thalamus

> thalamus is a fully extensible, self-hosted, open-source agentic OS, built on
> one belief: code is becoming cheap, coding agents are interchangeable, and the
> way you want to work is the thing worth owning. It does for agents what an OS
> does for programs — one memory that survives sessions and engine swaps, one
> trust gate that classifies every action before it runs, durable jobs that
> outlive restarts — and everything above the ten-noun kernel is a plugin.
> Engines (Claude Code, Codex, opencode, local models) are replaceable adapters,
> not foundations. A kernel, not a cortex. ${site.license} licensed. Free.
> Pre-release.

## The bet

Software is being commoditised. Generation, review and iteration are compressing,
so code is becoming cheap, fast and abundant. When code is no longer the scarce
resource, three things become scarce instead: **coherence** (knowing what is true
across projects, people and time), **judgement** (deciding what should run, ship,
wait, or never touch production), and **attention** (the human loop that still
owns irreversible, external and high-stakes moves).

In that world another chat window is not leverage, and a coding agent that forgets
last week is not leverage. The durable layer is. thalamus is the OS for the era of
commodity software: the engines are interchangeable, and the part worth owning is
the system that remembers, routes, gates — and works the way you want it to.

## Facts

- Name: thalamus
- Site: ${site.url}
- Licence: ${site.license} (${site.licenseUrl})
- Price: free. Self-hosted, so you pay only for your own compute and model tokens.
- Status: pre-release (v0), shipping soon. Interfaces, contracts and storage layouts can still change until release.
- Runtime: Node.js / TypeScript. Linux and macOS.
- Harnesses driven: 8 — Claude Code, Codex, Cursor, opencode, Gemini CLI, GitHub Copilot, Cline, and local models via Ollama. Each is an adapter behind one driver port, so swapping one leaves memory, history and trust rules untouched.
- Kernel size: 10 nouns (listed below). Everything else is a plugin or a driver.
- Install: \`${installCommand}\`${soon("install")}
- Hosting model: self-hosted only. No account, no tenancy, no hosted service.
- Category: agentic OS, agent operating system, extensible plugin platform, AI agent orchestration, coding-agent control plane, meta-harness, agent memory layer, self-hosted developer infrastructure.

## Kernel and extensibility

The kernel is deliberately small — ten dedicated nouns:
authority, action log, trust gate, jobs, memory port, resource registry, RPC
registry, plugin lifecycle, clock, settlement receipts.

Everything above it is a plugin — surfaces, sources, skills, harnesses — with a
manifest, declared capabilities and default-deny permissions. Below it are
drivers: memory, model, transport, storage. Both are replaceable, and extending
thalamus means writing a plugin rather than forking it.

Current limit: the v0 plugin host runs a bounded reference adapter. It does
not yet load arbitrary third-party code and is not an untrusted-code sandbox;
community plugins stay quarantined until that boundary is real.

## Autonomy model

- Own infrastructure, reversible: the agent acts, then logs.
- Risky, external or spend-bearing: the agent proposes; a human approves before it runs.
- Client-facing work: draft only; a human ships it.
- Outbound email: draft only, never sent. No exceptions.

## Pages

- [thalamus — the fully extensible, self-hosted agentic OS](${site.url}/): what it is, what runs overnight, and how work is routed.
- [Something is always on](${site.url}/#alive): how signals route through the relay to whichever engine is free.
- [Starts empty, grows into anything](${site.url}/#plugins): the plugin model.
- [Under everything, a kernel](${site.url}/#architecture): the layer stack and the ten kernel nouns.
- [What thalamus is](${site.url}/#what): the one-sentence definition.\n- [The dissection](${site.url}/#anatomy): which part of a brain thalamus actually is.\n- [Questions](${site.url}/#faq): the full FAQ.
${questions.map((item) => `  - [${item.q}](${site.url}/#${item.id})`).join("\n")}

## Optional

- [Waitlist](${site.url}/#waitlist): one email the day v0 is installable.
- [Source repository](${site.repo})${soon("github")}
- [llms-full.txt](${site.url}/llms-full.txt): the same content plus every FAQ answer in full, for a single fetch.
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Useful to an agent, not useful in a search index.
      "X-Robots-Tag": "noindex",
    },
  });
