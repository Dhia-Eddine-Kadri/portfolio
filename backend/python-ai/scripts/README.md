# Python AI Scripts

Utility scripts for live evaluation and manual tuning of the Python AI service.

## `run_math_eval.py`

Runs the math/RAG fixture at a live `/ask` endpoint and writes a Markdown report under `scripts/eval_runs/`.

Use it when tuning:

- exercise reference detection
- document/chunk scoring
- formula-sheet retrieval
- lecture-vs-exercise source selection
- missing-context behavior
- answer formatting for engineering/math problems

## Required Environment

```bash
export MINALLO_EVAL_BASE_URL=https://minallo-ai.fly.dev
export MINALLO_EVAL_USER_ID=<supabase-user-uuid-that-owns-the-course>
export MINALLO_EVAL_JWT=<supabase-access-token>
```

Optional:

```bash
export MINALLO_EVAL_COURSE_ID=<course-uuid>
```

`MINALLO_EVAL_COURSE_ID` overrides `TODO_COURSE` placeholders in the fixture so you can run the same cases against one real course.

## Run

```bash
cd backend/python-ai
python scripts/run_math_eval.py
```

## Reading The Report

Cases with unresolved `TODO_*` expected sources are skipped unless `MINALLO_EVAL_COURSE_ID` is set.

After a run:

1. Open the generated Markdown report in `scripts/eval_runs/`.
2. Check whether the answer used the expected lecture/exercise/formula sources.
3. Check whether the final answer followed the expected structure.
4. Mark failures by category.
5. Tune retrieval/ranking/prompt behavior based on repeated failure patterns.

Do not tune ranking constants from a single case. Look for systematic failures across buckets.
