"""
StudySphere Dev Agents
======================
These agents are invoked BY Claude Code during development — not by the user.

Claude Code uses them as follows:
  - research  : before implementing anything that requires external knowledge
  - qa        : after writing/editing code, to catch bugs before finishing
  - review    : before declaring a task done, to check quality

All output goes to stdout so Claude Code can read and act on it.

Setup (one-time):
    pip install claude-agent-sdk

Internal usage by Claude Code:
    python agents.py research "<question>"    → get facts before coding
    python agents.py qa "<file1> [file2 ...]" → validate edited files
    python agents.py review "<file>"          → quality check before done
"""

import anyio
import sys
import os
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition, ResultMessage

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


# ── Agent system prompts ───────────────────────────────────────────────────────

RESEARCH_AGENT = AgentDefinition(
    description=(
        "Answers technical questions by searching the web and reading docs. "
        "Returns a structured, actionable summary that the developer can use immediately."
    ),
    prompt="""You are a technical research assistant helping a developer.
Your job: answer a specific question accurately and concisely so the developer can write correct code.

Process:
1. Search for the most authoritative source (official docs, RFC, MDN, etc.)
2. Read the relevant pages — don't guess, verify.
3. Return a structured answer with these sections:
   - **Answer**: direct answer to the question (2-4 sentences)
   - **Key details**: bullet points of facts the developer needs to know
   - **Code example**: minimal working example if relevant
   - **Gotchas**: common mistakes or edge cases to watch out for
   - **Sources**: URLs you used

Be precise. No filler. If something is uncertain, say so explicitly.""",
    tools=["WebSearch", "WebFetch"],
)

QA_AGENT = AgentDefinition(
    description=(
        "Validates edited JS/HTML files for bugs, broken DOM references, "
        "and logic errors. Returns a prioritised list of issues."
    ),
    prompt="""You are a QA engineer validating changes to a vanilla JS single-page application.
Stack: pure JS (no frameworks), HTML injected via innerHTML, all JS in window scope.

Your job: find real bugs in the files you're given. Not style issues — bugs.

Check for:
1. DOM ID/class references in JS that don't exist in any HTML file
2. Variables or functions called before they're defined (window scope issues)
3. Missing null/undefined checks before .getElementById or property access
4. Event listeners attached to elements that may not exist at attach time
5. Async operations where the result is used synchronously
6. localStorage keys that are written under one name but read under another
7. Any function that can throw an uncaught exception

Output format — only report actual problems, nothing hypothetical:
  CRITICAL: <issue> — <file>:<line>
  HIGH:     <issue> — <file>:<line>
  MEDIUM:   <issue> — <file>:<line>

If no issues found, say "No bugs found in the checked files." and nothing else.
Do NOT suggest refactors, improvements, or style changes.""",
    tools=["Read", "Grep", "Glob"],
)

REVIEW_AGENT = AgentDefinition(
    description=(
        "Reviews a JS/HTML file for security vulnerabilities, memory leaks, "
        "and convention violations specific to this project."
    ),
    prompt="""You are a senior code reviewer for a vanilla JS SPA.

Project conventions you must enforce:
- No frameworks (no jQuery, React, Vue, etc.)
- No build tools (no webpack, vite, etc.)
- DOM access via getElementById / querySelector only
- Night mode via body.night class + CSS vars
- State in localStorage with keys: ss_state, ss_dark, ss_chat_<filename>
- Auth tokens never stored in JS variables longer than a session

Review checklist:
1. SECURITY: XSS vectors (innerHTML with user data), exposed API keys, insecure localStorage usage
2. MEMORY LEAKS: setInterval/setTimeout not cleared, event listeners added in loops without removal
3. CONVENTION VIOLATIONS: framework imports, non-standard localStorage key names, scripts in HTML
4. DEAD CODE: functions defined but never called, variables assigned but never read
5. CORRECTNESS: logic that looks right but has an off-by-one, wrong comparison, or silent failure

Output format:
  [SECURITY]    <issue> — line <N>
  [MEMORY]      <issue> — line <N>
  [CONVENTION]  <issue> — line <N>
  [DEAD CODE]   <issue> — line <N>
  [CORRECTNESS] <issue> — line <N>

Only report real findings. If a category is clean, skip it entirely.""",
    tools=["Read", "Grep", "Glob"],
)


# ── Runner functions ───────────────────────────────────────────────────────────

async def research(question: str) -> str:
    result = ""
    async for msg in query(
        prompt=question,
        options=ClaudeAgentOptions(
            cwd=PROJECT_DIR,
            allowed_tools=["WebSearch", "WebFetch", "Agent"],
            agents={"research": RESEARCH_AGENT},
            max_turns=15,
        ),
    ):
        if isinstance(msg, ResultMessage):
            result = msg.result
    return result


async def qa(files: list[str]) -> str:
    file_list = ", ".join(files) if files else "all recently modified JS and HTML files"
    result = ""
    async for msg in query(
        prompt=(
            f"Run a QA check on these files: {file_list}. "
            "Read each file carefully and report every bug you find. "
            "Also cross-check any DOM ID referenced in JS against the HTML files."
        ),
        options=ClaudeAgentOptions(
            cwd=PROJECT_DIR,
            allowed_tools=["Read", "Grep", "Glob", "Agent"],
            agents={"qa": QA_AGENT},
            max_turns=20,
        ),
    ):
        if isinstance(msg, ResultMessage):
            result = msg.result
    return result


async def review(file: str) -> str:
    result = ""
    async for msg in query(
        prompt=(
            f"Do a thorough code review of {file}. "
            "Check every line. Report all findings grouped by category."
        ),
        options=ClaudeAgentOptions(
            cwd=PROJECT_DIR,
            allowed_tools=["Read", "Grep", "Glob", "Agent"],
            agents={"review": REVIEW_AGENT},
            max_turns=20,
        ),
    ):
        if isinstance(msg, ResultMessage):
            result = msg.result
    return result


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    cmd = args[0].lower()

    if cmd == "research":
        question = " ".join(args[1:])
        if not question:
            print("Usage: python agents.py research <question>")
            sys.exit(1)
        print(anyio.run(research, question))

    elif cmd == "qa":
        files = args[1:]
        print(anyio.run(qa, files))

    elif cmd == "review":
        if len(args) < 2:
            print("Usage: python agents.py review <file>")
            sys.exit(1)
        print(anyio.run(review, args[1]))

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)
