# Suggestion evaluation

Measures how well the real prompt, provider code and parser find fitting emojis. It calls a live API,
so it never runs in CI (`npm test` only matches `test/**`).

## Run

Anthropic (default, model `claude-haiku-4-5`):

```bash
EVAL_API_KEY=sk-ant-... node scripts/eval-suggestions.mjs
```

An OpenAI-compatible endpoint:

```bash
EVAL_PROVIDER=openai-compatible EVAL_BASE_URL=https://api.openai.com/v1 EVAL_MODEL=gpt-4.1-mini EVAL_API_KEY=... node scripts/eval-suggestions.mjs
```

Settings (all environment variables):

- `EVAL_API_KEY` (required): the API key.
- `EVAL_PROVIDER`: `anthropic` (default) or `openai-compatible`.
- `EVAL_MODEL`: model id, default `claude-haiku-4-5`.
- `EVAL_BASE_URL`: optional base URL, defaults to the provider's public API.
- `EVAL_COUNT`: emojis requested per query, default `24`.

Requests run one after another with a short pause. A failed request becomes an error row and is not
scored. The table is printed and also written to `eval/last-report.txt`, which should be git-ignored.

## Samples

`eval/samples.json` holds 30 queries. Each has `expect` (3 to 6 emojis, at least one should appear) and
`avoid` (emojis that must not appear). They cover objects, emotions, situations, slang, work chat,
celebrations, weather, German, and two cases where a literal reading is wrong ("break a leg",
"sorry for your loss"). `npm test` validates the file.

## Reading the numbers

- Top 8 / Top 24: the share of samples where an expected emoji is among the first 8 or 24 suggestions.
- Rank: position of the first expected emoji (1 is best). Mean first-hit rank only counts samples that hit.
- Avoid violations: how many avoid-list emojis appeared anywhere in the suggestions. Aim for 0.
- Emojis compare through the bundled dataset, so variation selectors do not matter.

The expect lists are judgment calls: a miss can mean the list is too narrow. Read the rows before
changing the prompt.

## The key

The key is only read from the environment of the process. It is never printed, written to the report or
stored, and it is removed from any error text.
