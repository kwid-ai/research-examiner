# Research Evaluator

An AI-powered peer review system that evaluates research papers across 11 dimensions using a multi-agent architecture. Upload a PDF or DOCX and receive a structured academic assessment with scores, strengths, weaknesses, and journal recommendations.

## Features

- **11 Specialized Evaluation Agents** running in parallel, each covering a distinct dimension of academic quality
- **Real-time Streaming** — results appear as each agent completes, no waiting for the full pipeline
- **Publication Detection** — automatically skips publishability scoring for already-published papers
- **Follow-up Questions** — ask questions about your evaluation results in context
- **Flexible LLM Support** — works with any OpenAI-compatible endpoint (Claude, GPT-4, local models)
- **Credential Flexibility** — supply credentials via environment variables or the in-app settings panel

## Evaluation Dimensions

| Agent | Evaluates |
|-------|-----------|
| Tone & Language | Grammar, clarity, academic register, paragraph cohesion |
| Literature Review | Citation coverage, recency, gaps, self-citation bias |
| Methodology | Research design, sampling, validity, replicability, ethics |
| Aims & Coverage | Objective clarity, completeness, scope |
| Claims & Evidence | Baseless claims, unsupported conclusions, causal fallacies |
| Novelty & Contribution | New concepts, theoretical extension, significance |
| Tables & Figures | Numbering, captions, cross-references, consistency |
| Redundancy | Repeated ideas, padding, section duplication |
| Citations & Bibliography | Style consistency, in-text alignment, completeness |
| Publishability | Rigor, significance, journal recommendations *(skipped if pre-published)* |
| State-of-the-Art | Positioning against recent advances, baseline comparisons |

A **Chief Editor** agent synthesizes all 11 evaluations into a final verdict:
`Reject` → `Major Revision` → `Minor Revision` → `Accept with Corrections` → `Accept`

## Getting Started

### Prerequisites

- Node.js 18+
- An API key for a supported LLM (Claude, OpenAI, or any OpenAI-compatible provider)

### Installation

```bash
git clone <repo-url>
cd research_evaluator_js
npm install
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env`:

```env
API_KEY=your_api_key_here
LLM_URL=https://api.anthropic.com/v1   # or your provider's base URL
LLM_MODEL=claude-sonnet-4-6            # or gpt-4o, etc.
LOG_LEVEL=                              # set to "debug" for verbose logging
```

All four variables are optional — credentials can also be entered directly in the app's settings panel at runtime.

### Running

```bash
# Development
npm run dev
# → http://localhost:3000

# Production
npm run build
npm start
```

## Usage

1. Open the app in your browser
2. (Optional) Click the settings icon to enter your API key, model, and base URL
3. Upload a PDF or DOCX research paper (max 10 MB)
4. Watch the 11 agents evaluate the paper in real time
5. Review scores (0–10), strengths, weaknesses, and recommendations per dimension
6. Read the Chief Editor's final verdict and journal recommendations
7. Use the follow-up question box to ask clarifying questions about the review

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | API key for your LLM provider |
| `LLM_URL` | Provider default | Base URL for an OpenAI-compatible endpoint |
| `LLM_MODEL` | `gpt-4o` | Model name to use for all agents |
| `LOG_LEVEL` | — | Set to `debug` to enable debug logging |

Credentials supplied in the UI override environment variables on a per-request basis.

## Tech Stack

- **Framework**: Next.js 15 (App Router) + React 18
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **LLM SDK**: `@anthropic-ai/sdk` / `openai` (OpenAI-compatible)
- **Document Parsing**: `pdf-parse` (PDF), `mammoth` (DOCX/DOC)
- **Streaming**: Server-Sent Events (SSE)

## Project Structure

```
app/
├── page.tsx              # Main UI (file upload, live progress, results)
├── layout.tsx            # Root layout and metadata
├── globals.css           # Global styles and animations
└── api/
    ├── evaluate/route.ts # POST /api/evaluate — document evaluation pipeline
    └── followup/route.ts # POST /api/followup — follow-up question handler
lib/
├── agents.ts             # 11 specialist agents + Chief Editor
├── document-processor.ts # PDF/DOCX parsing and section detection
└── logger.ts             # Structured server-side logging
```

## Scripts

```bash
npm run dev    # Start development server
npm run build  # Build for production
npm start      # Start production server
npm run lint   # Run ESLint
```
