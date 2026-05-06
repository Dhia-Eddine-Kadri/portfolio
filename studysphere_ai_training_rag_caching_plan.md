# StudySphere AI Training, RAG, and Caching Plan

This document explains how StudySphere should handle uploaded lecture files, exercises, professor-specific course material, repeated questions, token usage, and “training” the AI.

The most important idea:

```txt
Do not fine-tune the model on every uploaded lecture file.

Use:
RAG + caching + strict prompting + citations + optional fine-tuning later.
```

For StudySphere, “training” should mainly mean building a course-specific knowledge system around the AI, not trying to put every PDF directly into the model.

---

## 1. Core Idea

The AI should not answer from general memory when the student asks about uploaded course material.

The correct flow is:

```txt
User asks a question
↓
Backend identifies the user and active course
↓
Backend searches only that user's/course's uploaded lecture files, exercises, notes, and solutions
↓
Backend retrieves the most relevant document chunks
↓
AI receives only those chunks as context
↓
AI answers only from those chunks
↓
AI cites the source files/pages
↓
If the answer is not in the documents, AI says so
```

This is called:

```txt
Retrieval-Augmented Generation, or RAG
```

RAG is better than fine-tuning for StudySphere because:

```txt
each student uploads different files
each professor teaches differently
files change every semester
answers need exact citations
the AI must follow the uploaded documents, not general internet knowledge
```

---

## 2. Why Fine-Tuning Alone Is Not Enough

Fine-tuning is useful, but not for storing every lecture file.

Fine-tuning is good for:

```txt
answer style
format
tone
step-by-step solution style
how detailed answers should be
how to produce flashcards
how to generate quizzes
how to refuse unsupported questions
how to cite sources consistently
```

Fine-tuning is bad for:

```txt
storing every uploaded PDF
remembering each student's private documents
updating when a professor uploads new slides
answering with exact file/page citations
preventing hallucinations by itself
```

Bad architecture:

```txt
Upload lecture PDFs
↓
Fine-tune model
↓
Ask questions
```

Better architecture:

```txt
Upload lecture PDFs
↓
Extract text
↓
Chunk text
↓
Create embeddings
↓
Store searchable chunks
↓
Retrieve relevant chunks per question
↓
Generate grounded answer with citations
```

Fine-tuning can come later, but only to improve how the AI answers, not what course knowledge it knows.

---

## 3. Ideal StudySphere AI Architecture

The full system should have these layers:

```txt
1. Document ingestion
2. Text extraction
3. Chunking
4. Embeddings / vector search
5. Retrieval
6. Answer generation
7. Citation checking
8. Answer caching
9. User feedback loop
10. Optional fine-tuning
```

---

# Part A: Document Processing

## 4. Document Ingestion

When a student uploads lecture files, exercises, or notes, the backend should store metadata for each file.

Recommended metadata:

```txt
file_id
user_id
course_id
semester_id
professor_name optional
file_name
file_type
source_type
upload_date
page_count
storage_path
processing_status
document_hash
```

Possible `source_type` values:

```txt
lecture
exercise
solution
notes
exam
summary
other
```

Recommended table:

```sql
documents
- id
- user_id
- course_id
- semester_id
- professor_name
- file_name
- file_type
- source_type
- storage_path
- page_count
- processing_status
- document_hash
- created_at
- updated_at
```

Processing status values:

```txt
uploaded
extracting_text
chunking
embedding
ready
failed
```

This allows the frontend to show progress like:

```txt
Uploaded
Extracting text
Creating study index
Ready for AI
```

Later, this can be connected to WebSockets for live progress updates.

---

## 5. Text Extraction

The backend should extract text from each uploaded file.

For PDFs:

```txt
extract page-by-page text
preserve page numbers
preserve headings if possible
preserve formulas/definitions as well as possible
```

For lecture slides:

```txt
keep slide number
keep slide title
keep bullet hierarchy
```

For exercises:

```txt
separate problem statement
separate subquestions
separate official solution if available
```

Recommended table:

```sql
document_pages
- id
- document_id
- user_id
- course_id
- page_number
- raw_text
- cleaned_text
- created_at
```

This matters because the AI should cite:

```txt
TM2_Lecture_04.pdf, page 17
```

or:

```txt
Exercise_03.pdf, problem 2
```

---

## 6. Chunking

Do not send entire PDFs to the AI every time. That wastes tokens and is expensive.

Split documents into smaller chunks.

Good starting strategy:

```txt
chunk size: 500-1000 tokens
overlap: 100-150 tokens
preserve page metadata
preserve heading/title metadata
preserve document/course/user metadata
```

Recommended table:

```sql
document_chunks
- id
- user_id
- course_id
- document_id
- page_start
- page_end
- chunk_text
- chunk_index
- source_type
- embedding
- created_at
```

Each chunk should have metadata like:

```json
{
  "user_id": "user_123",
  "course_id": "tm2",
  "document_id": "lecture_04",
  "file_name": "TM2_Lecture_04.pdf",
  "page_start": 16,
  "page_end": 18,
  "source_type": "lecture"
}
```

This metadata is critical so the AI only searches the correct student’s/course’s documents.

---

## 7. Embeddings and Vector Search

Each chunk needs an embedding.

An embedding is a numerical representation of the meaning of the text.

When a user asks a question:

```txt
question → embedding
```

Then the database searches for document chunks with similar embeddings.

Two implementation options:

### Option A: OpenAI Vector Stores / File Search

Good for:

```txt
faster implementation
less custom infrastructure
built-in retrieval
```

Possible limitation:

```txt
less custom control over ranking, filtering, and database behavior
```

### Option B: Supabase pgvector

This gives more control.

Good for StudySphere because you already use Supabase and need:

```txt
strict user filtering
strict course filtering
custom source priority
custom caching
custom citation display
custom RLS/security policies
```

Recommended long-term approach:

```txt
Supabase pgvector
```

---

# Part B: Retrieval and Answering

## 8. Retrieval Flow

When a user asks:

```txt
How do I calculate the moment of inertia here?
```

The backend should:

```txt
1. Verify the user from the Supabase token
2. Identify the active course
3. Normalize/rewrite the question if needed
4. Embed the question
5. Search chunks only from that user and course
6. Retrieve top 5-10 relevant chunks
7. Optionally rerank the chunks
8. Send only those chunks to the AI
```

Very important:

```txt
Never search across all users.
```

Bad:

```txt
Search all documents from all students
```

Good:

```txt
Search only:
user_id = auth.uid()
course_id = active_course_id
```

For shared/public courses later, add controlled shared-access logic.

---

## 9. Preventing Answers Outside the Documents

This requires:

```txt
strict retrieval
strict system prompt
source citations
answer validation
```

System prompt idea:

```txt
You are StudySphere AI.

Answer only using the provided course context.
The context contains excerpts from the student's uploaded lecture files, exercises, notes, and solutions.

Rules:
1. If the answer is not supported by the provided context, say:
   "I could not find this in your uploaded course materials."
2. Do not invent definitions, formulas, theorem names, professor preferences, or exercise solutions.
3. Prefer the professor's notation and terminology from the context.
4. Cite the source file and page/section for every important claim.
5. If the context is insufficient, ask the student to upload the relevant lecture or exercise.
```

Context sent to the model should look like:

```txt
COURSE CONTEXT:

[Source 1]
File: TM2_Lecture_04.pdf
Pages: 16-18
Text:
...

[Source 2]
File: Exercise_03.pdf
Page: 2
Text:
...
```

Recommended answer sections:

```txt
Answer
Sources used
Confidence: high / medium / low
```

---

## 10. Strict Course Mode

Add a mode:

```txt
Strict course mode: ON
```

In strict mode:

```txt
AI may only answer from retrieved chunks
AI must cite sources
AI must refuse unsupported answers
AI must not use outside knowledge unless explicitly allowed
```

Use strict mode for:

```txt
exam preparation
lecture-specific questions
professor-specific notation
exercise solutions
course-specific explanations
```

Optional:

```txt
General helper mode: OFF by default
```

If the user asks:

```txt
Can you explain this with outside examples?
```

Then the AI may use outside knowledge, but it should label it clearly:

```txt
Outside explanation, not from uploaded lecture material:
...
```

---

## 11. Professor-Specific Behavior

You want answers based on what the professor used in class.

To do that, store metadata for each document:

```txt
course_id
professor_name
semester
source_type
lecture_number
exercise_number
is_official_prof_material
```

Then retrieval should prioritize sources:

```txt
1. professor lecture slides
2. professor exercise sheets
3. professor official solutions
4. student's own notes
5. generated summaries
```

Example ranking formula:

```txt
final_score =
semantic_similarity
+ source_type_boost
+ recency_boost
+ professor_material_boost
```

Example boosts:

```txt
official lecture: +0.10
official exercise: +0.08
official solution: +0.08
student note: +0.02
AI-generated summary: -0.03
```

This helps the AI follow the professor’s material instead of general textbook style.

---

## 12. Course-Specific AI Memory

Do not use one global memory for everything.

Use separate indexes by:

```txt
user
course
semester
```

Example:

```txt
User: Dali
Course: Technische Mechanik 2
Semester: WS 2025/26
Documents:
- Lecture 01
- Lecture 02
- Exercise 01
- Exercise 02
```

When asking inside TM2, the AI should not retrieve Regelungstechnik files unless the user explicitly asks across courses.

---

## 13. Mandatory Citations

Every answer should include sources.

Example:

```txt
Sources:
1. TM2_Lecture_04.pdf, pages 16-18
2. Exercise_03.pdf, problem 2
```

Every retrieved chunk should include:

```txt
source_id
file_name
page_start
page_end
chunk_text
```

Recommended model output format:

```json
{
  "answer": "...",
  "sources": [
    {
      "file_name": "TM2_Lecture_04.pdf",
      "pages": "16-18",
      "quote_or_summary": "Definition of moment..."
    }
  ],
  "confidence": "high",
  "unsupported": false
}
```

The frontend can then render this nicely.

---

## 14. Guardrail After Answer Generation

Before showing the answer, check whether it is supported.

Basic code-level checks:

```txt
If no chunks retrieved → refuse
If retrieved similarity is below threshold → refuse
If answer has no sources → refuse or regenerate
If answer cites a source not in retrieved chunks → reject
```

More advanced:

```txt
Use a smaller model to verify whether the answer is supported by the retrieved context.
```

This reduces hallucinations.

---

# Part C: Token Reduction and Repeated Questions

## 15. Do Not Send All Documents Every Time

To reduce token usage:

```txt
Do not send all lecture files to the AI every time.
```

Use this layered approach:

```txt
Layer 1: exact answer cache
Layer 2: semantic question cache
Layer 3: retrieval cache
Layer 4: retrieved document chunks
Layer 5: API prompt caching
```

---

## 16. Exact Answer Cache

If the same user asks the exact same question in the same course with the same document version, return the saved answer.

Recommended table:

```sql
ai_answer_cache
- id
- user_id
- course_id
- question_hash
- normalized_question
- document_version_hash
- answer_json
- sources_json
- created_at
- last_used_at
- usage_count
```

Normalize the question:

```txt
lowercase
trim spaces
remove repeated whitespace
maybe remove unnecessary punctuation
```

Hash input:

```txt
sha256(user_id + course_id + normalized_question + document_version_hash)
```

If there is a match:

```txt
return cached answer
do not call OpenAI
```

---

## 17. Semantic Question Cache

Students may ask the same thing differently:

```txt
What is the difference between torque and moment?
Explain torque vs moment.
Are torque and moment the same?
```

Use question embeddings to detect near-duplicates.

Recommended table:

```sql
ai_question_cache
- id
- user_id
- course_id
- question
- question_embedding
- answer_id
- document_version_hash
- created_at
```

Flow:

```txt
Embed new question
Search previous question embeddings
If similarity > 0.92 and document_version_hash is same
Return cached answer
```

Use this carefully. If similarity is too low, generate a fresh answer.

---

## 18. Document Version Hash

Caching must become invalid when the student uploads new lecture files.

Create:

```txt
document_version_hash = hash of all document IDs + updated_at timestamps + file sizes
```

If a new file is uploaded:

```txt
old cache should not be trusted automatically
```

Cache keys should include:

```txt
user_id
course_id
normalized_question
document_version_hash
```

This prevents outdated answers.

---

## 19. Retrieval Cache

You can also cache retrieval results.

Recommended table:

```sql
retrieval_cache
- user_id
- course_id
- question_hash
- top_chunk_ids
- document_version_hash
- created_at
```

If the user repeats the same question:

```txt
reuse same chunks
skip vector search
possibly skip OpenAI if answer cache exists
```

---

## 20. Prompt Caching Optimization

To benefit from API prompt caching, keep repeated prompt prefixes identical.

Use stable prompt order:

```txt
system instructions
app rules
answer format
then dynamic retrieved context
then user question
```

Keep the first part identical across requests.

Example:

```txt
SYSTEM:
You are StudySphere AI...
Rules...
Output format...
```

The common system prefix is likely to be reused often.

---

# Part D: Exercises and Course Material

## 21. Handling Exercises

Exercises need special handling.

When a student asks:

```txt
Solve exercise 3b
```

The AI should retrieve:

```txt
exercise sheet
related lecture sections
official solution if uploaded
student notes if relevant
```

If official solution exists:

```txt
Use official solution as highest priority.
```

If no official solution exists:

```txt
AI can solve it using lecture methods, but must say:
"I did not find an official solution in your uploaded files. I am solving this using the method from Lecture X."
```

This keeps answers honest.

---

## 22. Source Priority

Recommended priority:

```txt
1. Official solution
2. Exercise sheet
3. Lecture slides
4. Professor notes
5. Student notes
6. AI-generated summaries
```

Generated summaries should not outrank original lecture files.

---

# Part E: Fine-Tuning

## 23. When to Use Fine-Tuning

Use fine-tuning later, after you have logs and feedback.

Fine-tune for:

```txt
always cite sources
always say when unsupported
use German/English depending on course
format math cleanly
generate flashcards in your exact style
generate quizzes in your exact style
follow StudySphere answer structure
```

Do not fine-tune on every lecture file.

Instead, collect examples like:

```json
{
  "input": "Question + retrieved chunks",
  "ideal_output": "Grounded answer with citations and unsupported-claim behavior"
}
```

Start with:

```txt
100-300 high-quality examples
```

Then evaluate.

Examples should include:

```txt
normal answer found in docs
question not found in docs
ambiguous question
exercise solution with official solution
exercise solution without official solution
professor-specific notation
German lecture material
English lecture material
math formatting
citation formatting
```

---

## 24. Feedback Loop

Add feedback buttons:

```txt
Helpful
Not helpful
Wrong answer
Not in lecture
Missing citation
Wrong formula
Too vague
Wrong language
```

Recommended table:

```sql
ai_feedback
- id
- user_id
- course_id
- question
- answer_id
- rating
- feedback_text
- reason
- created_at
```

This feedback can later become:

```txt
evaluation data
fine-tuning examples
bug reports
prompt improvement data
```

---

# Part F: Implementation Plan

## 25. What Your Programmer Should Build First

### Phase 1: Basic RAG

```txt
Upload PDF
Extract text
Chunk text
Create embeddings
Store chunks
Search chunks
Answer with citations
```

### Phase 2: Strict Grounding

```txt
Refuse unsupported answers
Require citations
Add similarity threshold
Add source priority
Add course/user filtering
```

### Phase 3: Caching

```txt
Exact question cache
Semantic question cache
Retrieval cache
Document version hash
```

### Phase 4: Professor/Course Behavior

```txt
Document metadata
Source priority ranking
Official lecture/exercise/solution priority
Course-specific strict mode
```

### Phase 5: Evaluation

```txt
Test questions per course
Expected source files
Expected answer behavior
Hallucination checks
Unsupported question tests
```

### Phase 6: Optional Fine-Tuning

```txt
Collect ideal examples
Fine-tune for StudySphere answer behavior
Keep RAG as knowledge source
Evaluate before production
```

---

## 26. Database Tables to Add

Recommended tables:

```txt
documents
document_pages
document_chunks
ai_answer_cache
ai_question_cache
retrieval_cache
ai_feedback
ai_evaluations
```

### `documents`

```txt
id
user_id
course_id
semester_id
professor_name
file_name
file_type
source_type
storage_path
processing_status
document_hash
created_at
updated_at
```

### `document_pages`

```txt
id
document_id
user_id
course_id
page_number
raw_text
cleaned_text
created_at
```

### `document_chunks`

```txt
id
user_id
course_id
document_id
chunk_text
page_start
page_end
chunk_index
source_type
embedding
created_at
```

### `ai_answer_cache`

```txt
id
user_id
course_id
question_hash
normalized_question
document_version_hash
answer_json
sources_json
created_at
last_used_at
usage_count
```

### `ai_question_cache`

```txt
id
user_id
course_id
question
question_embedding
answer_id
document_version_hash
created_at
```

### `retrieval_cache`

```txt
id
user_id
course_id
question_hash
top_chunk_ids
document_version_hash
created_at
```

### `ai_feedback`

```txt
id
user_id
course_id
question
answer_id
rating
feedback_text
reason
created_at
```

### `ai_evaluations`

```txt
id
course_id
test_question
expected_behavior
expected_sources
actual_answer
passed
notes
created_at
```

---

## 27. API Endpoints to Build

Recommended endpoints:

```txt
POST /api/documents/upload
POST /api/documents/process
GET  /api/courses/:courseId/documents
POST /api/ai/ask
POST /api/ai/feedback
GET  /api/ai/cache/:questionHash
```

For:

```txt
POST /api/ai/ask
```

Backend should:

```txt
verify user
verify course access
check exact cache
check semantic cache
retrieve chunks
generate answer
validate citations
store answer
return answer
```

Frontend should only send:

```json
{
  "courseId": "tm2",
  "question": "How do we calculate moment of inertia?",
  "mode": "strict"
}
```

The backend should handle retrieval, caching, citations, and answer generation.

---

# Part G: Evaluation

## 28. How to Know It Works

For each course, create test questions:

```txt
20 questions answered in lectures
10 questions answered in exercises
10 questions not in uploaded material
10 ambiguous questions
10 repeated/paraphrased questions
```

Measure:

```txt
Is the answer grounded in source?
Is the citation correct?
Does it refuse unsupported questions?
Does it use professor notation?
Does it avoid inventing?
Does cache hit work?
Does answer update after new file upload?
```

---

## 29. Repeated Question Flow

Full repeated-question flow:

```txt
User asks question
↓
Normalize question
↓
Check exact cache
  → if hit: return answer
↓
Check semantic cache
  → if high similarity and same document hash: return answer
↓
Run vector search
↓
If no strong chunks:
  → answer "not found in uploaded material"
↓
Generate answer using retrieved chunks
↓
Validate answer has sources
↓
Store answer in cache
↓
Return answer
```

---

# 30. Final Programmer Summary

Tell your programmer:

```txt
Do not fine-tune the model on every uploaded lecture file.

Build a RAG system:
- extract uploaded files
- chunk by page/section
- embed chunks
- store chunks with user_id, course_id, file_id, page metadata
- retrieve only relevant chunks for the active course
- answer only from retrieved chunks
- cite file/page sources
- refuse unsupported answers
- cache exact and semantic repeated questions
- invalidate cache when course documents change
- collect feedback and use it later for fine-tuning behavior
```

The final system should work like:

```txt
Documents are not memorized by the model.
Documents are stored in a searchable knowledge base.
The AI retrieves the right lecture/exercise context at answer time.
Repeated questions use cache.
Fine-tuning is optional later for answer style, not document knowledge.
```

---

# 31. Main Principle

The AI should behave like this:

```txt
If it is in the uploaded course material:
  answer with citations.

If it is not in the uploaded course material:
  say it was not found.

If using outside knowledge is allowed:
  clearly label it as outside explanation.

If the user repeats a question:
  use cache instead of paying for a new full answer.

If new documents are uploaded:
  invalidate old cache and retrieve from the new document version.
```

That is the architecture needed for a professor-specific, document-grounded, token-efficient StudySphere AI.
