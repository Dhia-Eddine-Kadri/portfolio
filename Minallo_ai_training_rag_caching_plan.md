# Minallo AI Training, RAG, and Caching Plan

This document explains how Minallo should handle uploaded lecture files, exercises, professor-specific course material, repeated questions, token usage, and the idea of “training” the AI.

The most important idea:

```txt
Do not fine-tune the model on every uploaded lecture file.

Use:
RAG + strict user/course filtering + caching + strict prompting + citations + evaluation + optional fine-tuning later.
```

For Minallo, “training” should mainly mean building a course-specific knowledge system around the AI. The AI should not permanently memorize every PDF. Instead, Minallo should extract, organize, search, and retrieve the right parts of the student’s uploaded material whenever the student asks a question.

---

## 1. Core Product Idea

Minallo should be a personal file-based AI tutor.

The student uploads their own study material, such as:

```txt
lecture slides
lecture notes
exercise sheets
official solutions
professor handouts
summaries
past exams
textbook chapters
research PDFs
student notes
```

Then the student can ask:

```txt
Explain this topic from my lecture notes.
Give me examples based only on the uploaded files.
Solve exercise 3b using the lecture method.
What did the professor say about this formula?
Create flashcards from lecture 4.
Make quiz questions from the uploaded chapter.
Summarize the important parts for the exam.
```

The AI should answer using only the files uploaded by that student for the active course, unless the user explicitly allows outside knowledge.

A simple product promise:

> Upload your course materials and ask questions. Minallo answers from your own files, explains concepts clearly, gives examples, and shows exactly where the answer came from.

The key trust rule:

> If the uploaded files do not contain enough information to answer, the AI should say so instead of making up an answer.

---

## 2. Important Clarification: The AI Does Not Truly “Learn” the Files Permanently

A common misunderstanding is that the AI uploads a file, studies it permanently, and remembers everything forever.

That is usually not how this should work.

The correct approach is:

```txt
User uploads files
↓
System extracts text
↓
System splits the text into chunks
↓
System creates embeddings for those chunks
↓
System stores the chunks in a searchable database
↓
User asks a question
↓
System retrieves the most relevant chunks
↓
AI receives those chunks as temporary context
↓
AI answers based on that context
```

So the AI is not memorizing the documents permanently. It is more like:

> Before answering, the AI quickly looks up the most relevant parts of the uploaded files and uses them to answer.

This is called:

```txt
Retrieval-Augmented Generation, or RAG
```

This distinction matters because it affects architecture, cost, privacy, reliability, and citations.

---

## 3. Why RAG Is the Right Approach for Minallo

RAG is better than fine-tuning for Minallo because:

```txt
each student uploads different files
each professor teaches differently
files change every semester
answers need exact citations
students need answers based on uploaded course material, not general internet knowledge
private student files should not become part of a global model
new uploads should become available quickly
old answers should update when documents change
```

RAG is especially useful for students because the AI can follow:

```txt
the professor's notation
the course's exact definitions
the uploaded exercise sheets
the official solution style
the language of the course
the topics actually covered in class
```

---

## 4. What Minallo Should Not Be

Minallo should not be described as a general chatbot.

Bad positioning:

```txt
An AI that can answer any question.
```

Better positioning:

```txt
A document-grounded AI study assistant that answers from your uploaded course materials.
```

The main value is not just that the AI can answer. The main value is that it answers while staying grounded in the student’s own files.

---

## 5. High-Level System Flow

The correct flow is:

```txt
User asks a question
↓
Backend identifies the authenticated user
↓
Backend identifies the active course
↓
Backend searches only that user's/course's uploaded files
↓
Backend retrieves the most relevant chunks
↓
Backend reranks and filters chunks
↓
AI receives only those chunks as context
↓
AI answers only from those chunks
↓
AI cites the source files/pages/sections
↓
System validates citations and support
↓
If the answer is not in the documents, AI says so
↓
Answer and sources are cached when safe
```

Very important:

```txt
Never search across all users.
Never allow one user's files to appear in another user's answer.
Never answer unsupported course-specific questions as if they were found in the uploaded files.
```

---

## 6. Ideal Minallo AI Architecture

The full system should have these layers:

```txt
1. Document ingestion
2. Text extraction
3. Text cleaning
4. Document structure detection
5. Chunking
6. Embeddings / vector search
7. Metadata filtering
8. Retrieval
9. Reranking
10. Answer generation
11. Citation checking
12. Support validation
13. Answer caching
14. Feedback collection
15. Evaluation
16. Optional fine-tuning later
```

---

# Part A: Document Processing

## 7. Document Ingestion

When a student uploads lecture files, exercises, or notes, the backend should store the original file and metadata.

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
language
is_official_prof_material optional
lecture_number optional
exercise_number optional
exam_year optional
```

Possible `source_type` values:

```txt
lecture
exercise
solution
notes
exam
summary
textbook
formula_sheet
research_paper
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
- language
- is_official_prof_material
- lecture_number
- exercise_number
- created_at
- updated_at
```

Processing status values:

```txt
uploaded
extracting_text
cleaning_text
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

Later, this can be connected to WebSockets or server-sent events for live progress updates.

---

## 8. Supported File Types

Recommended first supported file types:

```txt
PDF
DOCX
TXT
Markdown
PowerPoint slides
```

Later supported file types:

```txt
images with OCR
scanned PDFs
LaTeX files
CSV or spreadsheets for data-heavy courses
```

Important rule:

```txt
If text extraction quality is poor, Minallo should warn the user.
```

Example warning:

```txt
This file looks scanned or has low text quality. Some answers may be incomplete unless OCR is improved.
```

---

## 9. Text Extraction

The backend should extract text from each uploaded file while preserving useful structure.

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
preserve speaker notes if available
```

For exercises:

```txt
separate problem statement
separate subquestions
separate official solution if available
preserve exercise number and subpart labels
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
- extraction_quality_score
- created_at
```

This matters because the AI should cite:

```txt
TM2_Lecture_04.pdf, page 17
```

or:

```txt
Exercise_03.pdf, problem 2b
```

---

## 10. Text Cleaning

Before chunking, clean extracted text.

Cleaning should:

```txt
remove repeated headers/footers when possible
fix broken line breaks
preserve mathematical notation where possible
preserve bullet structure
preserve page boundaries
remove unreadable extraction artifacts
```

Do not over-clean.

Bad cleaning can remove formulas, symbols, or professor-specific notation.

---

## 11. Chunking

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
- section_title
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
  "section_title": "Moment of Inertia",
  "source_type": "lecture"
}
```

This metadata is critical so the AI only searches the correct student’s/course’s documents.

### Bad Chunking

Bad chunking splits text randomly and breaks important ideas apart.

Example:

```txt
Chunk 1: Active transport is the movement of molecules...
Chunk 2: ...against their concentration gradient and requires energy.
```

If only Chunk 1 is retrieved, the answer may be incomplete.

### Better Chunking

Better chunking follows structure:

```txt
headings
subheadings
page numbers
slide titles
paragraph boundaries
topic changes
lists
examples
exercise subquestions
```

The goal is to create chunks that are complete enough to answer questions but small enough to search accurately.

---

## 12. Embeddings and Vector Search

Each chunk needs an embedding.

An embedding is a numerical representation of the meaning of the text.

When a user asks a question:

```txt
question → embedding
```

Then the database searches for document chunks with similar embeddings.

Two implementation options:

### Option A: Managed Vector Stores / File Search

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

Good for Minallo because you already use Supabase and need:

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

## 13. Retrieval Flow

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
6. Retrieve top 10-20 candidate chunks
7. Rerank chunks
8. Keep the best 3-8 chunks
9. Send only those chunks to the AI
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

## 14. Hybrid Search

Vector search is good, but it can miss exact terms, formulas, theorem names, exercise numbers, and professor-specific words.

Use hybrid search:

```txt
semantic vector search
+
keyword/full-text search
+
metadata filters
+
reranking
```

Examples where keyword search helps:

```txt
"Exercise 3b"
"Satz von Steiner"
"Laplace transform"
"Na-K pump"
"Bernoulli equation"
"F = ma"
```

Recommended retrieval strategy:

```txt
1. Run vector search for meaning
2. Run keyword search for exact terms
3. Merge results
4. Remove duplicates
5. Apply source priority boosts
6. Rerank final candidates
```

---

## 15. Reranking

Initial retrieval may find related chunks, but not the best chunks.

Reranking improves quality by reordering candidate chunks based on how well they answer the specific question.

Recommended flow:

```txt
retrieve top 20 chunks
rerank down to top 5
send top 5 to the AI
```

Reranking helps prevent the system from retrieving text that is generally related but not actually useful.

---

## 16. Preventing Answers Outside the Documents

This requires:

```txt
strict retrieval
strict system prompt
source citations
answer validation
```

System prompt idea:

```txt
You are Minallo AI.

Answer only using the provided course context.
The context contains excerpts from the student's uploaded lecture files, exercises, notes, and solutions.

Rules:
1. If the answer is not supported by the provided context, say:
   "I could not find this in your uploaded course materials."
2. Do not invent definitions, formulas, theorem names, professor preferences, or exercise solutions.
3. Prefer the professor's notation and terminology from the context.
4. Cite the source file and page/section for every important claim.
5. If the context is insufficient, ask the student to upload the relevant lecture or exercise.
6. If outside knowledge is allowed, clearly label it as outside knowledge.
```

Context sent to the model should look like:

```txt
COURSE CONTEXT:

[Source 1]
File: TM2_Lecture_04.pdf
Pages: 16-18
Section: Moment of Inertia
Text:
...

[Source 2]
File: Exercise_03.pdf
Page: 2
Problem: 2b
Text:
...
```

Recommended answer sections:

```txt
Answer
Examples, if requested
Sources used
Confidence: high / medium / low
```

---

## 17. Strict Course Mode

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

## 18. Professor-Specific Behavior

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
+ keyword_match_boost
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

## 19. Course-Specific AI Memory

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

## 20. Mandatory Citations

Every grounded answer should include sources.

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
section_title
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
      "section": "Moment of Inertia",
      "quote_or_summary": "Definition of moment..."
    }
  ],
  "confidence": "high",
  "unsupported": false
}
```

The frontend can then render this nicely.

---

## 21. Guardrail After Answer Generation

Before showing the answer, check whether it is supported.

Basic code-level checks:

```txt
If no chunks retrieved → refuse
If retrieved similarity is below threshold → refuse
If answer has no sources → refuse or regenerate
If answer cites a source not in retrieved chunks → reject
If strict mode is ON and answer contains unsupported outside facts → reject
```

More advanced:

```txt
Use a smaller model to verify whether the answer is supported by the retrieved context.
```

This reduces hallucinations.

---

## 22. Handling “Examples” Questions

Students will often ask for examples, not just definitions.

Examples should follow this rule:

```txt
If examples exist in uploaded files, use those first.
If no examples exist but the concept is explained, the AI may create a simple example only if allowed by the mode.
If strict mode is ON, clearly label generated examples as created by the AI using the uploaded concept.
```

Example response wording:

```txt
The uploaded lecture explains the definition but does not include a worked example. Here is a simple example created from that definition, not copied from the lecture.
```

This keeps the system useful without pretending that generated examples came from the files.

---

# Part C: Token Reduction and Repeated Questions

## 23. Do Not Send All Documents Every Time

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

## 24. Exact Answer Cache

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
sha256(user_id + course_id + normalized_question + document_version_hash + mode)
```

If there is a match:

```txt
return cached answer
do not call the AI model
```

---

## 25. Semantic Question Cache

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
- mode
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

## 26. Document Version Hash

Caching must become invalid when the student uploads, deletes, or updates lecture files.

Create:

```txt
document_version_hash = hash of all document IDs + updated_at timestamps + file sizes + document_hashes
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
mode
```

This prevents outdated answers.

---

## 27. Retrieval Cache

You can also cache retrieval results.

Recommended table:

```sql
retrieval_cache
- user_id
- course_id
- question_hash
- top_chunk_ids
- document_version_hash
- mode
- created_at
```

If the user repeats the same question:

```txt
reuse same chunks
skip vector search
possibly skip AI call if answer cache exists
```

---

## 28. Prompt Caching Optimization

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
You are Minallo AI...
Rules...
Output format...
```

The common system prefix is likely to be reused often.

---

# Part D: Exercises and Course Material

## 29. Handling Exercises

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

## 30. Source Priority

Recommended priority:

```txt
1. Official solution
2. Exercise sheet
3. Lecture slides
4. Professor notes
5. Student notes
6. Original textbook/source material
7. AI-generated summaries
```

Generated summaries should not outrank original lecture files.

---

## 31. Generated Study Tools

Minallo can also generate study tools from uploaded files.

Useful features:

```txt
summaries
flashcards
multiple-choice quizzes
practice questions
worked-example explanations
exam checklists
formula sheets
concept maps
```

Rule:

```txt
Generated study tools should cite the source files they were created from.
```

Example:

```txt
Flashcards generated from:
- TM2_Lecture_04.pdf, pages 12-20
- Exercise_03.pdf, pages 1-3
```

---

# Part E: Fine-Tuning

## 32. Why Fine-Tuning Alone Is Not Enough

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

## 33. When to Use Fine-Tuning

Use fine-tuning later, after you have logs and feedback.

Fine-tune for:

```txt
always cite sources
always say when unsupported
use German/English depending on course
format math cleanly
generate flashcards in your exact style
generate quizzes in your exact style
follow Minallo answer structure
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

## 34. Feedback Loop

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

# Part F: Security, Privacy, and Access Control

## 35. Strict User Isolation

This is one of the most important parts of the product.

Every document, page, chunk, cache entry, and answer should belong to a specific user and course.

Required filters:

```txt
user_id = authenticated user
course_id = selected course
```

Recommended security:

```txt
Supabase Row Level Security
server-side auth checks
signed file URLs
private storage buckets
no client-side direct vector search across all chunks
```

Never trust the frontend alone.

The backend should enforce access rules before retrieval.

---

## 36. Shared Courses Later

Later, Minallo may support shared course material.

Example:

```txt
A professor uploads official slides for a course.
All students in that course can use them.
```

Then you need access levels:

```txt
private_user_file
shared_course_file
professor_official_file
public_resource
```

Retrieval should include:

```txt
private files owned by the user
+
shared files the user has permission to access
```

It should not include random files from other users.

---

# Part G: Implementation Plan

## 37. What Your Programmer Should Build First

### Phase 1: Basic RAG

```txt
Upload PDF
Extract text
Chunk text
Create embeddings
Store chunks
Search chunks by user and course
Answer with citations
```

### Phase 2: Strict Grounding

```txt
Refuse unsupported answers
Require citations
Add similarity threshold
Add source priority
Add course/user filtering
Add citation validation
```

### Phase 3: Better Retrieval

```txt
Hybrid search
Reranking
Exercise-number detection
Professor/source priority boosts
Better chunking by heading/page/slide
```

### Phase 4: Caching

```txt
Exact question cache
Semantic question cache
Retrieval cache
Document version hash
Prompt caching optimization
```

### Phase 5: Professor/Course Behavior

```txt
Document metadata
Source priority ranking
Official lecture/exercise/solution priority
Course-specific strict mode
Language preference by course
```

### Phase 6: Evaluation

```txt
Test questions per course
Expected source files
Expected answer behavior
Hallucination checks
Unsupported question tests
Cache invalidation tests
```

### Phase 7: Optional Fine-Tuning

```txt
Collect ideal examples
Fine-tune for Minallo answer behavior
Keep RAG as knowledge source
Evaluate before production
```

---

## 38. MVP Scope

The MVP should be simple and trustworthy.

Build this first:

```txt
User uploads PDF files to a course
System extracts text page-by-page
System chunks text
System stores embeddings in Supabase pgvector
Student asks a question in that course
System retrieves only that user's course chunks
AI answers with citations
AI refuses unsupported questions
```

Do not build everything at once.

Avoid in MVP:

```txt
fine-tuning
complex multi-agent systems
automatic web search
cross-user shared knowledge
large-scale professor marketplace
advanced OCR for every scanned document
```

MVP success condition:

```txt
A student uploads lecture PDFs and can ask accurate questions with cited answers from those PDFs.
```

---

## 39. Database Tables to Add

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
page_count
processing_status
document_hash
language
is_official_prof_material
lecture_number
exercise_number
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
extraction_quality_score
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
section_title
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
mode
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
mode
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
mode
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

## 40. API Endpoints to Build

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
rerank chunks
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

## 41. Example Backend Pseudocode

```ts
async function askMinalloAI({ userId, courseId, question, mode }) {
  await verifyCourseAccess(userId, courseId);

  const documentVersionHash = await getDocumentVersionHash(userId, courseId);
  const normalizedQuestion = normalizeQuestion(question);
  const questionHash = hash(userId, courseId, normalizedQuestion, documentVersionHash, mode);

  const exactCachedAnswer = await findExactCachedAnswer(questionHash);
  if (exactCachedAnswer) return exactCachedAnswer;

  const semanticCachedAnswer = await findSemanticCachedAnswer({
    userId,
    courseId,
    question,
    documentVersionHash,
    mode,
    minSimilarity: 0.92
  });
  if (semanticCachedAnswer) return semanticCachedAnswer;

  const candidateChunks = await hybridRetrieveChunks({
    userId,
    courseId,
    question,
    limit: 20
  });

  const rerankedChunks = await rerankChunks(question, candidateChunks);
  const selectedChunks = rerankedChunks.slice(0, 5);

  if (selectedChunks.length === 0 || selectedChunks[0].score < MIN_SCORE) {
    return unsupportedAnswer(question);
  }

  const answer = await generateGroundedAnswer({
    question,
    chunks: selectedChunks,
    mode
  });

  const validation = await validateAnswerSupport(answer, selectedChunks, mode);
  if (!validation.passed) {
    return unsupportedAnswer(question);
  }

  await storeAnswerCache({
    userId,
    courseId,
    questionHash,
    normalizedQuestion,
    documentVersionHash,
    mode,
    answer
  });

  return answer;
}
```

---

# Part H: Frontend Experience

## 42. Upload Experience

The frontend should show document processing status.

Example:

```txt
File uploaded
Extracting text
Creating chunks
Creating study index
Ready for AI
```

If processing fails:

```txt
We could not extract readable text from this file. Try uploading a clearer PDF or enabling OCR.
```

---

## 43. Answer Experience

The answer UI should show:

```txt
answer
steps, if solving a problem
examples, if requested
sources used
confidence level
whether outside knowledge was used
feedback buttons
```

Example:

```txt
Answer:
...

Sources used:
- TM2_Lecture_04.pdf, pages 16-18
- Exercise_03.pdf, problem 2b

Confidence: High
Mode: Strict course mode
```

---

## 44. Suggested User Controls

Useful controls:

```txt
Strict course mode ON/OFF
Use outside knowledge ON/OFF
Select course
Select document subset
Choose answer length
Generate examples
Generate quiz
Generate flashcards
```

Default settings:

```txt
Strict course mode: ON
Outside knowledge: OFF
Citations: required
```

---

# Part I: Evaluation

## 45. How to Know It Works

For each course, create test questions:

```txt
20 questions answered in lectures
10 questions answered in exercises
10 questions not in uploaded material
10 ambiguous questions
10 repeated/paraphrased questions
10 exercise-solving questions
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
Does it retrieve the right exercise and lecture together?
```

---

## 46. Repeated Question Flow

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
Run hybrid search
↓
Rerank chunks
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

## 47. Common Failure Modes and Fixes

### Problem: AI gives vague answers

Possible causes:

```txt
retrieved chunks are too broad
chunks are too small
reranking is missing
question is ambiguous
```

Fixes:

```txt
improve chunking
use hybrid search
add reranking
ask a targeted follow-up only when necessary
```

### Problem: AI invents facts

Possible causes:

```txt
prompt is too loose
strict mode missing
no validation step
model is using general knowledge
```

Fixes:

```txt
strict system prompt
citation requirement
support validation
refuse when context is insufficient
```

### Problem: AI cannot find answers that are in the file

Possible causes:

```txt
bad text extraction
OCR missing
chunking broke the explanation
embedding search missed exact terms
metadata filters are wrong
```

Fixes:

```txt
improve extraction
add OCR
chunk by section/page
use hybrid search
check user_id/course_id filtering
```

### Problem: AI uses another course's files

Possible causes:

```txt
missing course filter
wrong active course
cache key missing course_id
```

Fixes:

```txt
require course_id in every retrieval and cache query
include course_id in cache keys
show active course clearly in frontend
```

### Problem: Cached answer is outdated

Possible causes:

```txt
document_version_hash missing
cache not invalidated after upload/delete/update
```

Fixes:

```txt
include document_version_hash in cache keys
recompute document version after every document change
```

---

# Part J: Final Programmer Summary

Tell your programmer:

```txt
Do not fine-tune the model on every uploaded lecture file.

Build a RAG system:
- extract uploaded files
- clean extracted text
- chunk by page/section/slide
- embed chunks
- store chunks with user_id, course_id, file_id, page metadata
- retrieve only relevant chunks for the authenticated user and active course
- use hybrid search and reranking
- answer only from retrieved chunks in strict mode
- cite file/page/section sources
- refuse unsupported answers
- cache exact and semantic repeated questions
- invalidate cache when course documents change
- collect feedback and use it later for evaluation and fine-tuning behavior
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

# 48. Main Principle

The AI should behave like this:

```txt
If it is in the uploaded course material:
  answer with citations.

If it is not in the uploaded course material:
  say it was not found.

If the uploaded material explains a concept but has no examples:
  say that and only generate an example if the mode allows it.

If using outside knowledge is allowed:
  clearly label it as outside explanation.

If the user repeats a question:
  use cache instead of paying for a new full answer.

If new documents are uploaded:
  invalidate old cache and retrieve from the new document version.
```

That is the architecture needed for a professor-specific, document-grounded, token-efficient Minallo AI.
