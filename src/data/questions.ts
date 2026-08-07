import { installCommand, site } from "../config/site";

/**
 * The FAQ, as data.
 *
 * This lives apart from the component because two places consume it: the
 * accordion in `Questions.astro` and the `FAQPage` node in the JSON-LD graph.
 * One array means the rendered answer and the declared answer cannot drift —
 * a schema that disagrees with the visible page is worse than no schema.
 *
 * Questions are phrased the way people actually type them, not the way a
 * product team would title a doc section. That is the whole point of the
 * surface: the query appears verbatim as a heading directly above a
 * self-contained answer.
 *
 * Q2, Q5 and Q8 carry ALL of the load-bearing honesty. The "honest bit"
 * disclosure that used to sit in the closing section was removed on
 * 2026-08-06, so these three answers are the only place the limits are stated
 * — what it is not, what the plugin host cannot do yet, and what you cannot
 * run today. "Agentic OS" is a big claim for a v0 and it stays credible only
 * because those limits sit beside the ambition. Do not soften them, and do not
 * remove them without putting them somewhere else first.
 */
export interface Question {
  /** Stable anchor id, so a single answer can be linked and cited by address. */
  id: string;
  q: string;
  a: string;
}

export const questions: Question[] = [
  {
    id: "what-is-an-agentic-os",
    q: "What is an agentic OS?",
    a: `What an operating system does for programs, done for agents: it owns the things no single agent can own for itself — memory that survives sessions, permissions that gate actions before they run, jobs that outlive restarts, and a plugin surface for everything else. The engines stay swappable; the OS is the part that persists. thalamus is that layer, self-hosted on your own hardware.`,
  },
  {
    id: "is-it-really-an-operating-system",
    q: "Is thalamus actually an operating system?",
    a: `It will not replace the operating system on your machine. It is an OS in the structural sense: a ten-noun kernel owns jobs, memory, authority and the action log; drivers make engines and memory backends swappable; everything else is a plugin with declared, default-deny capabilities. The test that matters — extending it means writing a plugin, not a fork. v0 is early; the shape is already this.`,
  },
  {
    id: "orchestrate-multiple-coding-agents",
    q: "What tools orchestrate multiple coding agents?",
    a: `Others put a task board over one vendor's agent, or host your state for you. thalamus takes the OS position: eight harnesses — Claude Code, Codex, Cursor, opencode, Gemini CLI, GitHub Copilot, Cline and local models via Ollama — are adapters behind one driver port, jobs are durable and survive restarts, and switching engines leaves your memory, history and trust rules exactly where they were. On your box.`,
  },
  {
    id: "share-memory-between-claude-code-and-codex",
    q: "How do I share memory between Claude Code and Codex?",
    a: `Put the memory outside both of them. Each harness keeps its own session state and forgets across restarts, so anything that must survive belongs in a store neither vendor owns. In thalamus, memory is an OS service behind a driver port: every engine reads and writes the same brain, and swapping engines never resets it.`,
  },
  {
    id: "build-your-own-plugins",
    q: "Can I build my own thalamus plugins?",
    a: `That's the whole design. Every capability above the kernel is a plugin — four kinds: surfaces, sources, skills and harnesses — each with a manifest, declared capabilities and default-deny permissions. Official ones install with one command; yours can start as a folder a coding agent wrote for you. The current limit: the v0 host runs a bounded reference adapter, and third-party code stays quarantined until the sandbox boundary is real.`,
  },
  {
    id: "self-hosted-or-cloud",
    q: "Is thalamus self-hosted, and is there a cloud version?",
    a: `Self-hosted only. No account, no tenancy, no hosted service to sign up for — you run it on your own hardware or you don't run it. That is the position, not a roadmap gap: an OS you don't own is someone else's computer with your memory in it.`,
  },
  {
    id: "how-much-does-it-cost",
    q: "How much does thalamus cost?",
    a: `Nothing. $0, ${site.license} licensed, self-hosted — the only bills are your own compute and your own model tokens. That follows from the bet: code generation is a commodity, so the OS meters it like one. Spend caps live in the trust gate, and an overnight run has a ceiling you set.`,
  },
  {
    id: "when-can-i-install-it",
    q: "When can I install thalamus?",
    a: `Soon — v0 is close. Today the repository is still private and \`${installCommand}\` is not live yet, so the waitlist below is the real answer: one email the day it runs, and nothing before it. Between now and then, interfaces, contracts and storage layouts can still move.`,
  },
];
