# Retirement scenarios

One-screen Next.js planner for retiring now: wealth sources with their own returns, income over time, college on a timeline, withdrawals, and ending principal.

## Design

- [`docs/design.md`](docs/design.md) — from [vercel.com/design.md](https://vercel.com/design.md)
- [`public/assets/vercel-brand.css`](public/assets/vercel-brand.css)

## Run

```bash
bun install
# Export AI_GATEWAY_API_KEY in your shell (or copy .env.example → .env.local)
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | For AI import | Vercel AI Gateway key used by `/api/import` |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | For Voice mode | Google Gemini key for Live ephemeral tokens (`/api/voice/live/token`) |
| `GEMINI_LIVE_MODEL` | Optional | Override Live model (default `gemini-3.1-flash-live-preview`) |

A shell-exported key is enough — no `.env.local` required. Optional `.env.local` still works for local overrides. Get a Gateway key from [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). Voice mode uses the same Gemini Live approach as [aitools-pgahq-com](https://github.com/pgahq/aitools-pgahq-com).

PDF import: browser renders pages to JPEGs (`pdfjs-dist` in `pdf-pages.ts`), then the vision model reads those images. No Firecrawl / PDF text extractor.

## Features

- **Guided setup**: first visit opens a narrative walkthrough (Framer Motion) instead of a dense form — age and horizon, lifestyle cost, savings by tax bucket, income, big expenses, then an animated result with live what-if levers. A persistent stage on the right redraws as each answer changes (lifeline → year-by-year bars → savings stack → balance curve). Skippable at any time; replay from **Guided setup** in the masthead (applies as one undoable change). `prefers-reduced-motion` is respected.
- **Voice mode**: compact masthead toggle + polygon visualizer → live Gemini assistant that reads/writes scenario inputs and computed page results (insights, milestones, year taxes/balances) with focus-based deixis (focused field only; hover ignored)
- **AI import**: paste notes, drop/paste screenshots, or upload a PDF (pages → images) — extract → confirm explanations → apply (`openai/gpt-5.6-luna` via AI Gateway)
- **Current Holdings**: taxable / Roth / Traditional / 401(k) / 529 — each with name, balance, fund/index rate
- **529s**: grow until linked college starts, then pay that college cost first
- **Income**: Social Security, pension, rental, etc. with start/end ages
- **College**: drag blocks to move; drag edges to change duration
- **Charts**: hover to inspect balances and cash flows by age
- **Explainers**: expandable help for gross-up taxes, withdrawal order, and more

Scenario state persists in `localStorage`.
