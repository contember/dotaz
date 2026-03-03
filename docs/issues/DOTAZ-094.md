# DOTAZ-094: AI SQL generation from natural language

**Phase**: 12 — DBeaver Parity
**Type**: fullstack
**Dependencies**: [DOTAZ-031]

## Description

Generate SQL queries from natural language descriptions using an LLM API. The editor provides schema context (tables, columns, types, FK relationships) so the model can generate accurate queries.

### UX Flow

1. User opens AI prompt (Ctrl+G or toolbar button)
2. Input field appears above/within SQL editor
3. User types natural language (e.g. "show all users who signed up last month with their order count")
4. LLM generates SQL using schema context
5. Generated SQL inserted into editor (as new content or replacing selection)
6. User can review, edit, and run normally

### Schema Context

- Automatically include relevant tables and columns from current connection
- Include FK relationships for JOIN generation
- Include column types for proper comparisons and casting
- Limit context to fit within token budget

### Architecture

- Backend service calls LLM API (configurable: Anthropic Claude, OpenAI, or local)
- API key configured in settings
- Schema context assembled on backend from existing schema introspection
- Streaming response for real-time SQL generation feedback

## Files

- `src/backend-shared/services/ai-sql.ts` — LLM integration, schema context builder, prompt template
- `src/shared/types/rpc.ts` — add `ai.generateSql` RPC endpoint
- `src/shared/types/settings.ts` — AI provider config (API key, model, endpoint)
- `src/backend-shared/rpc/rpc-handlers.ts` — AI SQL handler
- `src/frontend-shared/components/editor/AiPrompt.tsx` — natural language input UI
- `src/frontend-shared/components/editor/AiPrompt.css` — prompt styling
- `src/frontend-shared/components/editor/QueryToolbar.tsx` — AI button in toolbar
- `src/frontend-shared/stores/editor.ts` — AI generation state

## Acceptance Criteria

- [ ] Natural language input accessible via toolbar button or Ctrl+G
- [ ] Generated SQL inserted into editor
- [ ] Schema context (tables, columns, types, FKs) sent to LLM
- [ ] Configurable LLM provider and API key in settings
- [ ] Streaming response with real-time feedback
- [ ] Works with PostgreSQL and SQLite schema introspection
- [ ] Error handling for API failures (rate limit, invalid key, network)
- [ ] Generated SQL is editable before execution
