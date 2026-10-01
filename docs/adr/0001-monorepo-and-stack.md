# ADR-0001: pnpm monorepo with Next.js, NestJS and a shared package

**Status:** accepted · **Date:** 2026-09-26

**Context.** The repository was empty. The product needs a rich web UI, a REST/SSE backend and
background execution, with validation rules shared between client and server.

**Decision.** pnpm workspace with `apps/web` (Next.js App Router), `apps/api` (NestJS; the same
codebase runs the worker process) and `packages/shared` (Zod schemas, permission catalog, execution
state machine). No Python service: nothing in phase 1 needs Python; document extraction may justify
one in the RAG phase.

**Consequences.** One language end-to-end; schemas can't drift. The API and worker deploy from one
image. Adding a Python service later is an explicit, isolated decision.
