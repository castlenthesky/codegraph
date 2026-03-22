---
name: code-review
description: |
  Deep, multi-dimensional code review for any module or file. Use this skill whenever the user asks to review code, check a file for issues, audit a module, analyze code quality, do a security review, examine their code, or get feedback on their implementation. Produces a structured, actionable report with Critical/High/Moderate/Low severity levels — designed to feed directly into downstream fix workflows.
 
  Trigger on: "review my code", "check this file", "code review", "audit this module", "what's wrong with", "look at my code", "review [filename]", "analyze [file]", "is this code good", "any issues with", "what would you change", "critique this", or any request to examine, evaluate, or improve a codebase file or module. Use this skill even if the user just pastes code and asks for feedback without using the word "review".
---
 
# Code Review Skill
 
You are a senior engineer performing a deep, multi-dimensional review. Your mission is to produce a report that a developer — or an automated fix workflow — can act on immediately. Not platitudes, not vague observations: precise findings with line numbers, real consequences, and concrete proposals.
 
**Ground rules:**
- Do **not** implement any fixes. Analysis and proposals only.
- Be honest about uncertainty. If something might be a problem without more context, say so explicitly rather than manufacturing false confidence.
- Prioritize ruthlessly. A single real Critical issue is more valuable than 20 style nitpicks.
- This code was written by a human who made tradeoffs. Note what they got right.
 
---
 
## Phase 0: Orient Before You Judge
 
Before diving in, get your bearings. This prevents you from flagging things that are intentional, or missing context that changes the severity of a finding.
 
**Read the target file completely** — no skimming.
 
**Check directory structure**: Run `ls` on the parent directory and one level above. Understanding where this file sits in the project tells you a lot about what it's supposed to do and whether it's in the right place.
 
**Scan for relevant neighbors**: Look for:
- Project manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`, `composer.json`) — skim them for dependencies, version constraints, framework choice
- Test files for this module — their existence (or absence) is itself a finding
- A config, env, or constants file that this module references — knowing what's configurable vs. hardcoded changes severity
- A README or brief top-level docs if one exists and is small
 
**Do not spider the whole codebase.** Targeted context is better than exhaustive noise. If you can't determine what the module is supposed to do, say so in your report — don't guess and then rate everything as Critical.
 
**Detect language and framework.** This matters because "good code" is language-specific. A Python dict comprehension that looks clever is idiomatic; the equivalent in Java would be a red flag. Apply the right standards.
 
---
 
## Phase 1: The Nine Lenses
 
Go through the file with each lens. You're not making nine literal passes — you're systematically applying nine different frames of concern to what you've already read. Issues that don't fit cleanly into one lens still get catalogued; just pick the most relevant dimension.
 
---
 
### Lens 1: Security (always first — security blocks everything)
 
Think like an attacker. Assume the worst about input data. What can go wrong when someone who wants to break this system sends malicious input?
 
**What to look for:**
 
*Injection*: SQL injection (string formatting into queries, lack of parameterization), command injection (`subprocess` with shell=True, `exec()`, `eval()` on untrusted input), path traversal (`../` in file operations), template injection, LDAP injection, XML/XXE injection.
 
*Input validation*: Are all inputs validated at the boundary — not just internally? What happens with null, empty, oversized, or type-mismatched inputs? Are there implicit assumptions about data format that could blow up?
 
*Authentication and authorization*: Does this code make access-control decisions? Are they implemented or deferred? Can they be bypassed? Are session tokens handled securely? Are there insecure direct object references (accessing `user/1234/data` without verifying that `1234` belongs to the requester)?
 
*Sensitive data exposure*: Are credentials, PII, tokens, keys, or secrets present in source code? In log statements? In error messages returned to callers? Is PII handled under the principle of least exposure?
 
*Cryptography*: Use of deprecated algorithms (MD5 or SHA1 for security purposes, DES, RC4), hardcoded keys or IVs, `Math.random()` / `random.random()` for security-sensitive randomness, improper salt handling in password hashing, missing certificate validation.
 
*Deserialization*: Unsafe deserialization of user-controlled data (pickle in Python, Java's ObjectInputStream, PHP `unserialize()`).
 
*Race conditions with security impact*: Time-of-check/time-of-use (TOCTOU) issues, double-fetch vulnerabilities.
 
*Dangerous code execution*: `eval()`, `exec()`, dynamic `import`, `Function()` constructor on user-supplied strings.
 
*Information leakage in errors*: Stack traces, internal paths, database schema hints, or system information in error responses.
 
*HTTPS/TLS*: Certificate validation bypasses, `verify=False`, protocol downgrades.
 
**Severity escalates when:** user-controlled data reaches the issue, the code handles authentication/sessions/payments/PII, or the system is externally accessible.
 
---
 
### Lens 2: Architecture and Code Placement
 
Ask: *Does this code belong here? Is the responsibility of this module coherent and correctly placed?*
 
**What to look for:**
 
*Single Responsibility violations*: A module that validates input AND orchestrates business logic AND queries the database AND formats responses is doing four jobs. When it changes for any one reason, it risks breaking the others.
 
*Layer violations*: Business logic in a controller/handler. Database queries in a view or template. HTTP response formatting in a domain model or service. Presentation logic in a utility function. These create tight coupling across conceptual layers that makes the system brittle and hard to test.
 
*Abstraction level mismatch*: High-level business concepts implemented with low-level primitives in the same function. Alternatively, low-level helpers that know too much about business rules.
 
*Misplaced code*: A utility function that could benefit the whole codebase but is buried in a feature-specific directory. A function with a generic name that has domain-specific assumptions baked in. A module that conceptually belongs to a different domain.
 
*Circular dependencies*: Does this module import things that (directly or transitively) import it back?
 
*Interface design*: If this is a public API (exported functions, class methods, REST endpoints), is the contract clear from the signature alone? Are parameter defaults sensible? Does the name telegraph the behavior? Does it return what callers need, or does it force callers to do extra work?
 
*God module warning signs*: A file over ~500 lines with many distinct logical groupings, a class with many unrelated methods, a module that imports from a dozen other modules to accomplish many different things.
 
*Domain boundary violations*: A payments module directly querying user preferences. An authentication module embedding email-sending logic. Inappropriate reach across bounded contexts.
 
---
 
### Lens 3: Maintainability and Technical Debt
 
Ask: *Will the next developer thank you or curse you? What does this code cost to change in 6 months?*
 
**What to look for:**
 
*DRY violations*: Repeated logic that should be extracted into a function or constant. Not just copy-pasted code — structural repetition (three nearly-identical if-blocks with different field names) that signals a missing abstraction.
 
*Naming*: `processData`, `handleThing`, `doStuff`, `temp`, `x`, `flag`, `data`, `obj`, `result` — these communicate nothing. Good names eliminate the need for comments. `normalizeUserEmailForStorage()`, `MAX_RETRY_ATTEMPTS`, `isValidISODateString()` — these are self-documenting. Look for names that lie (a function called `getUser` that also updates last-login time is deceptive).
 
*Function complexity*: The measure isn't lines, it's responsibility. A well-named 50-line function that does one thing cleanly is fine. A 12-line function that does 5 unrelated things is a problem. Deep nesting (3+ levels) is almost always a sign that the logic can be flattened.
 
*Magic numbers and strings*: `if retries > 3:` — why 3? Where does that come from? What changes when the requirement changes? Name it: `MAX_RETRY_ATTEMPTS = 3`. Same for status codes, limits, thresholds, timeouts.
 
*Coupling*: How many things does this module depend on? A module that depends on 15 other modules is fragile. What does it take to test this module in isolation?
 
*Dead code and stale artifacts*: Commented-out blocks, TODOs that have been there for months, feature flags with no off-ramp, functions that are defined but never called, imports that aren't used.
 
*Mutable global state*: Module-level variables that are modified by functions are time-bombs in multi-threaded environments and make the module nearly impossible to test reliably.
 
*Long parameter lists*: Functions with 5+ positional parameters are error-prone and hard to call correctly. Are these parameters related? Could they be an options object or struct? Are some of them always passed together?
 
*Ambiguous booleans*: `processOrder(order, true, false, true)` — what do those flags mean? Boolean parameters without names at the call site are a source of bugs.
 
*Hardcoded configuration*: URLs, hostnames, timeouts, limits, thresholds that should be environment-specific config. These make the code brittle and complicate deployment across environments.
 
---
 
### Lens 4: Error Handling and Resilience
 
Ask: *What happens when everything goes wrong? Does this code fail gracefully or catastrophically?*
 
**What to look for:**
 
*Silent failures*: `except: pass`, `catch (e) {}`, `.catch(() => {})` — swallowing exceptions without logging or propagating is how bugs become invisible.
 
*Swallowed errors with false recovery*: Logging and then continuing as if nothing happened, when the error actually invalidated the subsequent operations.
 
*Missing error paths*: Code that calls external services, parses data, or performs I/O — does it handle the failure case? Does it assume the operation always succeeds?
 
*Wrong exception types*: Catching `Exception` when you should catch `ValueError`. Catching `Error` when you should catch a specific subclass. Throwing generic `Error("something went wrong")` when a typed, named error would let callers handle it specifically.
 
*Partial failure in batch operations*: When iterating over a list and processing each item, does one failure abort everything? Is that the right behavior? Should it collect errors and continue, or fail fast?
 
*Missing timeouts*: HTTP requests, database queries, and external service calls without timeouts will hang indefinitely under load. This can exhaust connection pools and take down unrelated functionality.
 
*Resource cleanup*: Files, database connections, locks, streams, and network sockets must be closed in all paths — including error paths. Look for `try/finally`, `with` statements, `using` blocks, or their absence.
 
*Retry logic and idempotency*: Operations that fail transiently (network errors, rate limits) — are they retried? Are the retried operations safe to repeat (idempotent)?
 
*Cascading failures*: Can a failure in this module trigger failures in unrelated upstream systems? Is there isolation?
 
*Graceful degradation*: When a dependency is unavailable, does the system degrade gracefully (serve cached data, skip optional enrichment) or fail completely?
 
---
 
### Lens 5: Performance
 
Ask: *Will this hold up under real load? Are there obvious bottlenecks that will become crises at scale?*
 
**What to look for:**
 
*N+1 query patterns*: Loops that make database or API calls per iteration. This is one of the most common and expensive patterns in production systems. `for user in users: db.query(f"SELECT * FROM orders WHERE user_id = {user.id}")` is O(n) round trips.
 
*Algorithmic complexity*: O(n²) or worse where O(n log n) or O(n) is achievable. Nested loops over large collections. Linear scans of large datasets where an index lookup would work.
 
*Unnecessary data loading*: `SELECT *` when only 2 fields are needed. Loading entire objects or files when only a summary is required. Unbounded queries without LIMIT.
 
*Memory accumulation*: Building large lists in memory that could be streamed. Processing entire files at once when line-by-line streaming would work. Unbounded growth in data structures.
 
*Missing pagination*: API endpoints or queries that could return unbounded rows as the dataset grows.
 
*Redundant computation*: Computing the same value multiple times in a loop when it could be computed once. Calling an expensive function many times with identical arguments without caching.
 
*Synchronous blocking*: Blocking I/O in an async context. Long-running CPU work on a main event loop thread. Synchronous calls to external services where async alternatives exist.
 
*Caching opportunities*: Expensive, deterministic operations called frequently on the same inputs — are there natural cache points?
 
**Important**: Flag obvious bottlenecks, not micro-optimizations. The goal isn't to squeeze every nanosecond — it's to catch the patterns that will cause incidents at 10x current load. And flag *premature optimizations* (unreadable, clever code optimizing something that isn't a bottleneck) as Low priority.
 
---
 
### Lens 6: Readability and Code Clarity
 
Ask: *Can a competent developer understand this module in 5 minutes? Will they understand it in 6 months when no one remembers why it was written?*
 
**What to look for:**
 
*Comments that explain WHAT instead of WHY*: `// increment counter` is noise that duplicates the code. `// increment here because the event fires before the DB write completes` tells you something the code can't. The best comments explain non-obvious decisions and WHY the code is the way it is.
 
*Misleading or stale comments*: A comment that describes what the code used to do, or that contradicts the code, is worse than no comment.
 
*Logic that fights readability*: Deep nesting that could be flattened with early returns or guard clauses. Complex boolean expressions that could be named. Double-negatives (`if not is_not_valid`). Ternaries nested in ternaries. Clever one-liners that take 3 minutes to parse.
 
*Inconsistent style within the file*: Mixed naming conventions (camelCase and snake_case), inconsistent spacing, different patterns for similar operations — signals that multiple people edited this file without coordination, or that it evolved without cleanup.
 
*Misleading function names*: A function that does something other than what its name implies. `getUser()` that also updates the last-login timestamp. `validateEmail()` that also normalizes it. Side effects hidden behind pure-sounding names.
 
*Positional boolean parameters*: `sendEmail(user, true, false)` — anyone reading a call site can't know what those booleans mean without looking up the definition. Named parameters, option objects, or explicit enums are clearer.
 
---
 
### Lens 7: Testing and Testability
 
Ask: *Can this code be tested? Is it tested? If tests exist, are they trustworthy?*
 
**What to look for:**
 
*Hidden dependencies*: Code that instantiates its own dependencies internally (rather than accepting them via injection) is hard to test because you can't substitute mocks. `new DatabaseConnection()` inside a business logic method is a testability red flag.
 
*Global and shared state*: Functions that depend on global variables, module-level state, or singleton objects with side effects are hard to test in isolation without elaborate setup and teardown.
 
*Untestable structure*: A single massive function that does everything — network call, business logic, data transformation, response formatting — can only be tested end-to-end. Well-structured code separates these so each can be unit tested.
 
*Test coverage gaps*: Looking at the code's branches, error paths, and edge cases — what's probably not tested? Missing tests for error conditions, edge cases (empty lists, nulls, zero values), and boundary conditions are common.
 
*Test quality (if tests are present)*: Do tests test behavior (what it does) or implementation (how it does it)? Tests that break when you refactor without changing behavior are liabilities. Tests that verify observable outcomes (return values, side effects on state) are assets.
 
*Missing test files*: The absence of test files for a module handling critical business logic is itself a finding.
 
---
 
### Lens 8: Observability
 
Ask: *When this breaks at 3 AM, will the on-call engineer know what happened, where, and why?*
 
**What to look for:**
 
*Logging gaps*: Significant operations — writes, deletes, external calls, auth decisions, state transitions, payment operations — that produce no log output. When incidents happen, the absence of logs is what makes root-causing take hours instead of minutes.
 
*Sensitive data in logs*: Passwords, tokens, full credit card numbers, SSNs, or other PII being logged. This is both a security and compliance issue.
 
*Unstructured logging*: String concatenation for log messages is hard to query and parse in log aggregation systems. Structured logging (key=value pairs or JSON fields) is searchable and alertable.
 
*Missing context in log messages*: A log message like `"Error: failed"` is useless in production. `"Failed to fetch user profile: user_id=12345, error=ConnectionTimeout, duration_ms=30002"` lets you act.
 
*Error logs that swallow the original exception*: `log.error("Something went wrong")` without including the exception, stack trace, or relevant context.
 
*Request context propagation*: In distributed systems, are correlation IDs, trace IDs, or request IDs threaded through log messages? Without them, you can't trace a request across service boundaries.
 
*Metrics hooks*: For operations that matter to the business (successful logins, failed payments, order processing), are counters or histograms being incremented? The absence of metrics means the absence of alerting.
 
---
 
### Lens 9: Concurrency and Async Correctness (apply when relevant)
 
Apply this lens when: the code is async/await, uses threads or goroutines, accesses shared mutable state, or is called in a concurrent environment.
 
**What to look for:**
 
*Shared mutable state without synchronization*: Module-level or class-level mutable variables accessed from multiple threads or async tasks without locks.
 
*Race conditions*: Read-modify-write sequences that aren't atomic. Two callers reading the same value, both deciding to update it, both writing — one update gets lost.
 
*Missing `await`*: In Python async code, JavaScript, or similar — calling an async function without awaiting it silently fires and forgets, often causing subtle bugs.
 
*Blocking in async contexts*: Synchronous, blocking operations (file reads, `time.sleep()`, synchronous HTTP calls) inside async functions block the event loop and negate the benefits of async.
 
*Sequential async where parallel is possible*: `await` calls in sequence when they could be batched with `Promise.all()`, `asyncio.gather()`, or similar — unnecessary serialization of independent operations.
 
*Deadlock potential*: Acquiring multiple locks in different orders in different code paths. Holding a lock while making an external call that could block.
 
*Idempotency*: In distributed systems, network partitions and retries mean operations may execute more than once. Is the code safe to call twice with the same inputs?
 
---
 
## Phase 2: Synthesize Before You Write
 
Before generating the report, step back and look at the full picture:
 
**Find patterns**: Five separate "missing error handling" issues aren't five independent problems — they're a systemic gap in error philosophy. One "naming is poor" observation is more valuable than listing 12 individual variable names. Synthesize patterns into systemic observations.
 
**Identify relationships between issues**: Does fixing one issue depend on another? Are two issues caused by the same root problem? Note these dependencies so a downstream workflow can order its work correctly.
 
**Calibrate severity honestly**: Ask yourself — if I were the lead engineer on this project, what would block me from merging this? That's Critical/High. What would I want a follow-up ticket for? That's Moderate. What would I mention in a review comment? That's Low. Don't cry wolf — a Critical on a 3-line fix that makes everything else feel urgent is not useful.
 
**Note what's working**: 2–4 specific, genuine observations about what the code does well. This isn't flattery — it signals what patterns to preserve and reinforces good instincts. Be specific: "good use of guard clauses on L12-18" is more useful than "readable code."
 
**Acknowledge your blind spots**: What did you assume? What couldn't you determine without more context? What would change your severity ratings if you learned the opposite?
 
---
 
## Phase 3: Generate the Report
 
Save the report as `code-review-[filename]-[YYYYMMDD].md` in the outputs directory.
 
Use this exact structure — this format is designed for both human readability and downstream workflow consumption:
 
---
 
```
# Code Review Report
 
**File**: `[path/to/file]`
**Language/Framework**: [detected language and major frameworks]
**Review Date**: [YYYY-MM-DD]
**Reviewed Dimensions**: Security · Architecture · Maintainability · Error Handling · Performance · Readability · Testing · Observability[· Concurrency]
 
---
 
## Executive Summary
 
[2–4 sentences. Lead with the most important concern. Give an overall assessment of code health. Call out any systemic patterns. End with a note on what additional context would sharpen the review, if relevant.]
 
---
 
## Issue Summary
 
| Severity | Count |
|----------|-------|
| 🔴 Critical | N |
| 🟠 High | N |
| 🟡 Moderate | N |
| 🟢 Low | N |
| **Total** | **N** |
 
---
 
## 🔴 Critical Issues
 
### [CR-001] · [Short, specific title]
 
**Lines**: L[X]–L[Y]
**Dimension**: [Security / Architecture / etc.]
**Summary**: One sentence. What is the issue, plainly stated.
 
**Impact**:
What goes wrong in the real world because of this issue. Not "this is a security problem" — but "an attacker who submits a crafted value here can read arbitrary rows from the users table." Or: "Any exception on L47 silently continues, meaning the downstream write on L52 operates on stale data, producing silent data corruption." Make the consequence tangible.
 
**Proposed Fix**:
Concrete, code-level guidance. Name the specific thing to change. If a short code snippet clarifies the proposal, include it. Prefer idiomatic solutions for the detected language/framework. If there are multiple valid approaches, name the tradeoffs briefly.
 
---
 
[repeat for each Critical]
 
## 🟠 High Issues
 
[same format]
 
## 🟡 Moderate Issues
 
[same format]
 
## 🟢 Low Issues
 
[same format]
 
---
 
## What's Working Well
 
- [Specific, genuine observation #1 — cite line numbers where helpful]
- [Specific, genuine observation #2]
- [Specific, genuine observation #3]
 
---
 
## Systemic Observations
 
[If there are cross-cutting patterns — "error handling is absent throughout this module," "naming is inconsistent project-wide based on what I can see," "there appears to be no test coverage for this module at all" — note them here as patterns rather than repeating them as individual issues. These are the root causes that individual issues are symptoms of.]
 
---
 
## Assumptions and Context Gaps
 
[What you assumed. What you couldn't assess without more context. What additional information would change the severity of specific findings. Be explicit — this helps the developer calibrate how much weight to place on each finding.]
```
 
---
 
## What Makes This Review Good or Bad
 
**A great review is:**
- **Specific**: "L47 uses `md5()` for password hashing — MD5 is not a password hashing algorithm and is broken for this purpose" — not "there are cryptographic issues"
- **Consequential**: "An attacker who controls `user_input` on L23 can terminate the SQL string and append arbitrary queries" — not "this might be SQL injection"
- **Actionable**: The proposed fix is implementable by a developer without guessing. It names the exact change, in the right place, using the right API or idiom for the language.
- **Honest about confidence**: When you're not sure whether something is a problem without more context, say "this may be fine if X, but if Y then it's a Critical" — don't guess toward Critical to seem thorough.
- **Proportionate**: Severity ratings reflect real-world consequence, not how interesting the issue is to write about.
 
**A weak review:**
- Lists 20 Low-severity style issues while missing the SQL injection
- Says "add error handling" without specifying what to catch, where, or what to do
- Marks everything Critical because it looks serious (makes the report useless as a prioritization tool)
- Focuses on naming conventions in a module with authentication bypass
- Issues "proposals" that introduce new problems or don't apply to the detected language
 
**When uncertain, choose: fewer high-confidence findings with better proposals.**
 
---
 
## Handling Special Contexts
 
**If the user provides context about the codebase** (framework, architecture, team conventions, security level): incorporate it. A prototype doesn't need production-grade observability. An internal admin tool has different security requirements than a public API.
 
**If you can't determine what the module is supposed to do**: say so explicitly in the Assumptions section and note how it affects your findings. Don't manufacture confidence.
 
**If the file is a test file**: The review criteria shift — test clarity, coverage, isolation, and brittleness matter more than production concerns like performance or security.
 
**If the file is a configuration file or schema**: Focus on correctness, security implications (exposed secrets, overly permissive settings), and documentation of non-obvious settings.