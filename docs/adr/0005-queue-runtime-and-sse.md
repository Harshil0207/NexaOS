# ADR-0005: BullMQ worker runtime, Postgres event log and SSE

**Status:** accepted · **Date:** 2026-09-26

**Context.** Agent runs take seconds to minutes and must survive restarts; the UI must update live.

**Decision.** Runs are rows with an explicit state machine; BullMQ on Redis distributes them to
worker processes. Every step persists progress; timeline events are an append-only table with a
per-run sequence number. Live updates use Server-Sent Events (one-directional, reconnect with
`Last-Event-ID` built into browsers) fed by Redis pub/sub, with replay from Postgres.

**Alternatives.** Kafka (not justified at this scale; Redis already needed), WebSockets (bi-directional
not required; SSE reconnect semantics are simpler), in-process execution (would tie runs to HTTP
requests).

**Consequences.** Horizontal worker scaling; at-least-once job delivery made safe by idempotent state
transitions and tool-call dedupe.
