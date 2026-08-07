import type { APIRoute } from "astro";
import { site, installCommand, AVAILABLE } from "../config/site";
import { questions } from "../data/questions";

/**
 * /llms-full.txt — the whole thing in one fetch.
 *
 * `llms.txt` is an index: short, and full of links a reader has to follow.
 * This is the opposite — every answer inline, so an agent that can afford one
 * request gets the complete picture and never needs a second round trip.
 *
 * Same clear eyes as `llms.txt` about who actually reads this. Consumer AI
 * search does not: Google has said it does not support the convention, and
 * OpenAI and Anthropic both point to robots.txt instead. Coding agents do —
 * Cursor, Cline and Continue among them — and those are the people thalamus is
 * for. This is a developer-experience surface, not an SEO tactic.
 *
 * The FAQ is generated from `src/data/questions.ts`, the same array that
 * renders the accordion and the FAQPage schema. Three surfaces, one source.
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

const faq = questions
  .map((item) => `### ${item.q}\n\n${item.a}\n\nAnchor: ${site.url}/#${item.id}`)
  .join("\n\n");

const body = `# thalamus — full text

> thalamus is a fully extensible, self-hosted, open-source agentic OS, built on
> one belief: code is becoming cheap, coding agents are interchangeable, and the
> way you want to work is the thing worth owning. It does for agents what an OS
> does for programs — one memory that survives sessions and engine swaps, one
> trust gate that classifies every action before it runs, durable jobs that
> outlive restarts — and everything above the ten-noun kernel is a plugin.
> Engines are replaceable adapters, not foundations. A kernel, not a cortex.
> ${site.license} licensed. Free. Pre-release.

This file is the complete text of ${site.url} in one fetch. Last updated
${site.lastUpdated}.

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
- Price: $0. Self-hosted, so you pay only for your own compute and model tokens.
- Status: pre-release (v0). Interfaces, contracts and storage layouts can still change until release.
- Runtime: Node.js / TypeScript. Linux and macOS.
- Install: \`${installCommand}\`${soon("install")}
- Hosting model: self-hosted only. No account, no tenancy, no hosted service.
- Kernel size: 10 nouns. Everything else is a plugin or a driver.
- Harnesses driven: 8.
- Category: agentic OS, agent operating system, extensible plugin platform, AI agent orchestration, coding-agent control plane, meta-harness, agent memory layer, self-hosted developer infrastructure.

## Harnesses

Eight coding agents, each an adapter behind one driver port. Swapping one leaves
memory, history and trust rules exactly where they were:

Claude Code, Codex, Cursor, opencode, Gemini CLI, GitHub Copilot, Cline, and
local models via Ollama.

## Kernel

The kernel is deliberately small — ten dedicated nouns:

1. authority
2. action log
3. trust gate
4. jobs
5. memory port
6. resource registry
7. RPC registry
8. plugin lifecycle
9. clock
10. settlement receipts

Everything above it is a plugin — surfaces, sources, skills, harnesses — with a
manifest, declared capabilities and default-deny permissions. Below it are
drivers: memory, model, transport, storage. Both are replaceable, and extending
thalamus means writing a plugin rather than forking it.

Current limit: the v0 plugin host runs a bounded reference adapter. It does not
yet load arbitrary third-party code and is not an untrusted-code sandbox;
community plugins stay quarantined until that boundary is real.

## Autonomy model

- Own infrastructure, reversible: the agent acts, then logs.
- Risky, external or spend-bearing: the agent proposes; a human approves before it runs.
- Client-facing work: draft only; a human ships it.
- Outbound email: draft only, never sent. No exceptions.

## Questions

${faq}

## Links

- Site: ${site.url}/
- Something is always on: ${site.url}/#alive
- Starts empty, grows into anything: ${site.url}/#plugins
- Under everything, a kernel: ${site.url}/#architecture
- Questions: ${site.url}/#what
- Waitlist: ${site.url}/#waitlist
- Source repository: ${site.repo}${soon("github")}
- Index version of this file: ${site.url}/llms.txt
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Useful to an agent, not useful in a search index — and indexing it
      // alongside the page it duplicates would be asking for a dupe-content
      // judgement on our own canonical.
      "X-Robots-Tag": "noindex",
    },
  });
