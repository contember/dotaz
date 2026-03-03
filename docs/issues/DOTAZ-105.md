# DOTAZ-105: Runtime validation for settings and shared types

**Phase**: 14 — Robustness & Tech Debt II
**Type**: fullstack
**Dependencies**: none

## Description

Several unsafe `as` casts bypass runtime validation when deserializing stored data. If the stored value is corrupted or from an older version, the cast silently produces an invalid value.

### 1. Settings deserialization guards

`settingsToAiConfig()` and `settingsToFormatProfile()` in `src/shared/types/settings.ts` cast raw strings to union types without checking:

```typescript
provider: (get("provider") as AiProvider) ?? DEFAULT_AI_CONFIG.provider,
dateFormat: (get("dateFormat") as DateFormat) ?? DEFAULT_FORMAT_PROFILE.dateFormat,
```

Add validation guards that check if the value is a member of the union before accepting it, falling back to the default otherwise:

```typescript
function isAiProvider(v: string | undefined): v is AiProvider {
    return v === "anthropic" || v === "openai" || v === "custom";
}
provider: isAiProvider(get("provider")) ? get("provider")! : DEFAULT_AI_CONFIG.provider,
```

Apply the same pattern to `DateFormat`, `DecimalSeparator`, `ThousandsSeparator`, `BooleanDisplay`, `BinaryDisplay`.

### 2. Import source type improvement

`ImportPreviewRequest` and `ImportOptions` in `src/shared/types/import.ts` allow both `fileContent` and `filePath` to be undefined, though at runtime exactly one is required. This is documented in comments but not enforced by types.

Add a shared `ImportSource` type:

```typescript
type ImportSource =
	| { fileContent: string; filePath?: undefined }
	| { filePath: string; fileContent?: undefined }
```

Use intersection with this type in `ImportPreviewRequest` and `ImportOptions`.

### 3. Comparison key collision fix

`buildRowKey()` in `src/shared/comparison.ts` uses `"\0NULL"` as a null sentinel and `"\0"` as a key separator. If a column value stringifies to `"\0NULL"`, it collides with the null sentinel.

Use a typed encoding: prefix values with a type tag (`N\0` for null, `V\0` for values) to make collisions impossible.

## Files

- `src/shared/types/settings.ts` — add type guards for all union types, use them in `settingsToAiConfig()` and `settingsToFormatProfile()`
- `src/shared/types/import.ts` — add `ImportSource` discriminated type, apply to `ImportPreviewRequest` and `ImportOptions`
- `src/shared/comparison.ts` — fix `buildRowKey()` null sentinel collision
- `tests/format-settings.test.ts` — test invalid stored values fall back to defaults
- `tests/comparison-service.test.ts` — test key building with edge-case values

## Acceptance Criteria

- [ ] Type guards for all settings union types (`AiProvider`, `DateFormat`, etc.)
- [ ] `settingsToAiConfig()` and `settingsToFormatProfile()` use guards, not raw casts
- [ ] Invalid stored settings fall back to defaults instead of passing through
- [ ] `ImportSource` discriminated type used in `ImportPreviewRequest` and `ImportOptions`
- [ ] `buildRowKey()` uses collision-free encoding for null values
- [ ] Tests cover invalid settings values and null key collisions
- [ ] `bunx tsc --noEmit` passes
- [ ] All tests pass
