# ADR-0006: Provider-agnostic LLM layer over raw HTTP

**Status:** accepted · **Date:** 2026-09-26

**Decision.** The runtime depends only on `LlmProvider.complete()` with a vendor-neutral message and
tool-call format. Providers are registered in `LlmRegistry`; agents reference `{provider, model}`.
The Anthropic adapter uses `fetch` directly (not the SDK) to own timeouts, streaming parse, and error
classification, and so tests can inject a fake transport. Retries happen in one place (`withRetry`)
and only for errors the adapter marks retryable.

**Consequences.** Adding OpenAI/Bedrock/local models means one adapter class. Embeddings for RAG will
follow the same pattern (`EmbeddingProvider`).
