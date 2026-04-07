# CPG Layer 6: Taint Analysis & Code Quality Detection

> **Status:** Planned  
> **Depends on:** [[01-UAST-Layer]], [[02-CFG-Layer]], [[03-PDG-Layer]], [[04-FalkorDB-Storage]]  
> **Purpose:** Extend the CPG pipeline with vulnerability detection (taint flows) and code quality analysis to feed an AI agent coding tool with actionable, graph-grounded findings.

---

## 1. Background: What Joern Teaches Us

The Joern project's [codepropertygraph](../../../.tmp/codepropertygraph) specification is the canonical reference for how to encode security and quality analysis into a graph. Its architecture separates three concerns cleanly:

1. **Schema** — what node/edge types exist and what properties they carry  
2. **Passes** — analysis algorithms that walk the graph and emit new nodes/edges  
3. **Traversals** — a fluent DSL for writing queries against the completed graph  

We already implement schema (node types, `REACHING_DEF`, `CDG` edges) and passes (CfgBuilder, PdgBuilder). What we need next is a taint pass and a set of query-driven detectors that produce `FINDING` nodes an AI agent can consume.

### Relevant Joern source files

| Concern | File |
|---|---|
| PDG / REACHING_DEF schema | [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Pdg.scala]] |
| AST node types | [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Ast.scala]] |
| FINDING node | [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Finding.scala]] |
| Call graph (ARGUMENT_INDEX, METHOD_FULL_NAME) | [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/CallGraph.scala]] |
| Pass framework | [[../../../.tmp/codepropertygraph/codepropertygraph/src/main/scala/io/shiftleft/passes/CpgPass.scala]] |
| Dominator schema | [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Dominators.scala]] |
| Hidden overlay concept | [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Hidden.scala]] |
| Generated GraphSchema (runtime) | [[../../../.tmp/codepropertygraph/domainClasses/src/main/generated/io/shiftleft/codepropertygraph/generated/GraphSchema.scala]] |
| Call neighboraccessors | [[../../../.tmp/codepropertygraph/domainClasses/src/main/generated/io/shiftleft/codepropertygraph/generated/neighboraccessors/Call.scala]] |
| Sample custom pass | [[../../../.tmp/codepropertygraph/samples/pass/src/main/scala/io/shiftleft/passes/mypass/SamplePass.scala]] |

---

## 2. Taint Analysis Model

### 2.1 Core Concepts

Taint analysis answers: *"Can data from a source (untrusted input) reach a sink (dangerous operation) without passing through a sanitizer?"*

The three primitives:

```
SOURCE ──[REACHING_DEF*]──> SINK
          must NOT pass through SANITIZER
```

Joern encodes this as a graph reachability problem over `REACHING_DEF` edges, where each edge carries a `variable` property naming the propagated variable. See [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Pdg.scala]] — `REACHING_DEF` is edge ID 26 with a string `VARIABLE` property.

### 2.2 Sources

A **source** is any node that introduces untrusted, user-controlled data:

| Source type | Example pattern (TypeScript/Python) | CPG match |
|---|---|---|
| HTTP request parameter | `req.query.x`, `req.params.x`, `request.GET['x']` | `CALL` where `methodFullName` matches `req.query.*` or `IDENTIFIER` with name matching known param patterns |
| Environment variable | `process.env.X`, `os.environ['X']` | `CALL` with `methodFullName` = `process.env.get` or `IDENTIFIER` name = `process.env` |
| File read | `fs.readFileSync(userPath)` | `CALL` with `methodFullName` in file-read sink set AND argument is tainted |
| Command-line arg | `process.argv[n]` | `CALL`/`IDENTIFIER` referencing `process.argv` |
| Database result | `db.query().rows[0]` | `CALL` to DB query methods |
| Deserialized input | `JSON.parse(x)`, `pickle.loads(x)` | `CALL` with method in deserialize set |

### 2.3 Sinks

A **sink** is a call where tainted data causes a vulnerability:

| Vulnerability class | Sink function patterns | Node match |
|---|---|---|
| SQL injection | `db.query(sql)`, `connection.execute(sql)` | `CALL` with `methodFullName` in sql sink set, argument index 0 |
| Command injection | `exec(cmd)`, `spawn(cmd)`, `child_process.exec` | `CALL` with `methodFullName` in shell sink set |
| Path traversal | `fs.readFile(path)`, `open(path)` | `CALL` in file sink set where path arg is tainted |
| XSS | `res.send(html)`, `innerHTML = x`, `document.write(x)` | `CALL` in html output set |
| Prototype pollution | `Object.assign(target, userObj)`, `merge(target, src)` | `CALL` in merge sink set with untrusted second arg |
| Deserialization | `eval(x)`, `Function(x)`, `pickle.loads(x)` | `CALL` in eval/deser set |
| SSRF | `fetch(url)`, `axios.get(url)`, `requests.get(url)` | `CALL` in http client set |
| Sensitive log exposure | `console.log(secret)`, `logger.info(password)` | `CALL` in logging set where arg is tagged sensitive |

### 2.4 Sanitizers

A **sanitizer** is a call that transforms or validates tainted data such that it is no longer dangerous for a specific sink class:

| Sanitizer type | Example | Cuts flow to |
|---|---|---|
| SQL escape | `db.escape(x)`, `parameterized query` | SQL sinks |
| HTML encode | `DOMPurify.sanitize(x)`, `escapeHtml(x)` | XSS sinks |
| Path normalize | `path.normalize(x)` + bounds check | Path traversal sinks |
| Input validation | `parseInt(x)`, `Number(x)` | Most sinks |
| Shell escape | `shellescape(x)` | Command injection sinks |

Sanitizers are modeled as `CALL` nodes whose output **breaks** the `REACHING_DEF` chain for a specific vulnerability class. The taint pass must be sanitizer-class-aware (a SQL escape does not sanitize a command injection).

---

## 3. New Graph Elements

### 3.1 Node: TAINT_SOURCE

```typescript
// New CpgNodeType values to add to src/types/cpg.ts
TAINT_SOURCE = 'TAINT_SOURCE',
TAINT_SINK   = 'TAINT_SINK',
SANITIZER    = 'SANITIZER',
FINDING      = 'FINDING',      // already in types but not yet produced
```

**Properties on TAINT_SOURCE:**
- `sourceType`: `HTTP_PARAM | ENV_VAR | FILE_READ | CLI_ARG | DB_RESULT | DESERIALIZED`
- `nodeId`: ID of the CPG node this tags (the CALL or IDENTIFIER that is the source)
- `confidence`: `HIGH | MEDIUM | LOW`

**Properties on TAINT_SINK:**
- `sinkType`: `SQL_INJECTION | COMMAND_INJECTION | PATH_TRAVERSAL | XSS | PROTOTYPE_POLLUTION | DESERIALIZATION | SSRF | SENSITIVE_LOG`
- `nodeId`: ID of the CALL node that is the sink
- `argumentIndex`: which argument position carries the taint

**Properties on SANITIZER:**
- `sanitizerType`: `SQL_ESCAPE | HTML_ENCODE | PATH_NORMALIZE | INPUT_VALIDATE | SHELL_ESCAPE`
- `nodeId`: ID of the CALL node
- `coversVulnClass`: which vulnerability class this sanitizer covers

**Properties on FINDING (from Joern schema — [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Finding.scala]]):**
- `name`: vulnerability name (e.g., `SQL_INJECTION`)
- `evidence`: JSON array of node IDs forming the taint path
- `severity`: `CRITICAL | HIGH | MEDIUM | LOW | INFO`
- `message`: human-readable description for AI agent consumption
- `ruleId`: rule identifier string
- `lineNumber`: source line of the sink
- `columnNumber`: column of the sink
- `filename`: file containing the sink

### 3.2 New Edge: TAINT_FLOW

A directed edge explicitly encoding one hop in a taint path:

```
(TAINT_SOURCE) -[TAINT_FLOW {variable, hopIndex}]-> (TAINT_SINK)
```

This is a **derived edge** computed by the taint pass and stored as an overlay — it does not replace `REACHING_DEF` edges but provides a query-optimized shortcut.

### 3.3 New Edge: FLOWS_TO

Connects a FINDING to the CALL/IDENTIFIER nodes that form its evidence chain:

```
(FINDING) -[FLOWS_TO {order}]-> (CALL|IDENTIFIER|...)
```

---

## 4. Implementation: TaintPass

The taint analysis runs as a post-PDG pass in the CPG pipeline — analogous to Joern's `CpgPass` pattern in [[../../../.tmp/codepropertygraph/codepropertygraph/src/main/scala/io/shiftleft/passes/CpgPass.scala]].

### 4.1 Algorithm: Forward Taint Propagation

```
TaintPass.run(graph):
  1. Load source definitions (SOURCE_DEFS)
  2. Load sink definitions (SINK_DEFS)  
  3. Load sanitizer definitions (SANITIZER_DEFS)
  
  For each source node S matching SOURCE_DEFS:
    worklist = [S]
    visited  = {}
    path     = [S]
    
    While worklist not empty:
      node = worklist.pop()
      If node in visited: continue
      visited.add(node)
      
      For each REACHING_DEF edge (node → next, variable=V):
        If next matches SANITIZER_DEFS for any vuln class:
          record sanitizer; prune that vuln class from live set
          continue
        
        If next matches SINK_DEFS:
          emit FINDING(source=S, sink=next, path=path+[next])
        
        worklist.push(next)
        path.push(next)
```

This mirrors Joern's approach of traversing the `REACHING_DEF` subgraph — see the edge definition in [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Pdg.scala]] which defines REACHING_DEF from virtually every expression node type to every other, with the `VARIABLE` property tracking what flows.

### 4.2 Cypher Queries for Taint Traversal

**Find all reachable nodes from a source via REACHING_DEF:**

```cypher
-- Forward slice from a source node
MATCH path = (src:CALL|IDENTIFIER {id: $sourceId})
             -[:REACHING_DEF*1..15]->
             (sink)
WHERE sink.methodFullName IN $sinkMethods
RETURN path
```

**Detect SQL injection (forward from HTTP param to DB query):**

```cypher
MATCH (param:IDENTIFIER)-[:REACHING_DEF*1..10]->(arg:IDENTIFIER)
      -[:ARGUMENT]->(call:CALL)
WHERE param.name IN ['req', 'request', 'query', 'params', 'body']
  AND call.methodFullName =~ '.*(query|execute|run).*'
  AND NOT EXISTS {
    MATCH (param)-[:REACHING_DEF*]->(san:CALL)
    WHERE san.methodFullName =~ '.*(escape|sanitize|parameterize).*'
      AND (san)-[:REACHING_DEF*]->(arg)
  }
RETURN param, call
```

**Backward slice from a sink (find all data sources reaching it):**

```cypher
MATCH path = (source)-[:REACHING_DEF*1..12]->(sink:CALL)
WHERE sink.methodFullName IN $sinkMethods
RETURN source, sink, [n IN nodes(path) | n.id] AS nodeIds
```

**Path existence between tagged source and sink:**

```cypher
MATCH (src:TAINT_SOURCE), (snk:TAINT_SINK)
WHERE src.nodeId = $srcId AND snk.nodeId = $snkId
MATCH path = (srcNode)-[:REACHING_DEF*1..20]->(snkNode)
WHERE srcNode.id = src.nodeId AND snkNode.id = snk.nodeId
RETURN path LIMIT 1
```

### 4.3 File: `src/graph/cpg/taint/TaintPass.ts`

```typescript
// Proposed interface
interface TaintPassResult {
  sources:    TaintSourceNode[];
  sinks:      TaintSinkNode[];
  sanitizers: SanitizerNode[];
  findings:   FindingNode[];
  taintEdges: TaintFlowEdge[];
}

class TaintPass {
  constructor(
    private db: FalkorDBStore,
    private rules: TaintRuleSet,
  ) {}

  async run(fileId: string): Promise<TaintPassResult>
  
  private identifySources(fileId: string): Promise<CpgNode[]>
  private identifySinks(fileId: string):   Promise<CpgNode[]>
  private identifySanitizers(fileId: string): Promise<CpgNode[]>
  private propagate(sources, sinks, sanitizers): FindingNode[]
  private emitFindings(findings: FindingNode[]): Promise<void>
}
```

---

## 5. Rule System

### 5.1 Rule File Format

Rules are plain TypeScript objects (no DSL needed at first). A rule set defines sources, sinks, and sanitizers per language:

```typescript
// src/graph/cpg/taint/rules/typescript.rules.ts

export const TypeScriptRules: TaintRuleSet = {
  language: 'typescript',
  
  sources: [
    {
      id:   'http-req-query',
      type: TaintSourceType.HTTP_PARAM,
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /^(req|request)\.(query|params|body|headers)/,
      },
      confidence: 'HIGH',
    },
    {
      id:   'process-env',
      type: TaintSourceType.ENV_VAR,
      match: {
        nodeType: 'IDENTIFIER',
        namePattern: /^process\.env\./,
      },
      confidence: 'MEDIUM',
    },
  ],
  
  sinks: [
    {
      id:   'sql-query',
      vulnClass: VulnClass.SQL_INJECTION,
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /\.(query|execute|run)\s*\(/,
        taintedArgIndex: 0,
      },
      severity: 'CRITICAL',
    },
    {
      id:   'child-process-exec',
      vulnClass: VulnClass.COMMAND_INJECTION,
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /^(child_process\.)?(exec|execSync|spawn|spawnSync)/,
        taintedArgIndex: 0,
      },
      severity: 'CRITICAL',
    },
    {
      id:   'fs-read',
      vulnClass: VulnClass.PATH_TRAVERSAL,
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /^fs\.(readFile|readFileSync|createReadStream)/,
        taintedArgIndex: 0,
      },
      severity: 'HIGH',
    },
    {
      id:   'res-send-html',
      vulnClass: VulnClass.XSS,
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /^(res|response)\.(send|write|end)/,
        taintedArgIndex: 0,
      },
      severity: 'HIGH',
    },
  ],
  
  sanitizers: [
    {
      id:  'sql-escape',
      coversVulnClass: [VulnClass.SQL_INJECTION],
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /\.(escape|escapeString|parameterize)/,
      },
    },
    {
      id:  'html-encode',
      coversVulnClass: [VulnClass.XSS],
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /(escapeHtml|sanitize|DOMPurify\.sanitize|encodeURIComponent)/,
      },
    },
    {
      id:  'path-resolve',
      coversVulnClass: [VulnClass.PATH_TRAVERSAL],
      match: {
        nodeType: 'CALL',
        methodFullNamePattern: /^path\.(resolve|normalize)/,
      },
    },
  ],
};
```

### 5.2 Python Rules

```typescript
// src/graph/cpg/taint/rules/python.rules.ts

export const PythonRules: TaintRuleSet = {
  language: 'python',
  sources: [
    { id: 'flask-request',   match: { methodFullNamePattern: /^(request\.(args|form|json|data|files|headers))/ } },
    { id: 'django-request',  match: { methodFullNamePattern: /^(request\.GET|request\.POST|request\.body)/ } },
    { id: 'os-environ',      match: { methodFullNamePattern: /^os\.environ/ } },
  ],
  sinks: [
    { id: 'sqlite-execute',    vulnClass: VulnClass.SQL_INJECTION,      match: { methodFullNamePattern: /\.(execute|executemany|executescript)/ } },
    { id: 'subprocess-call',   vulnClass: VulnClass.COMMAND_INJECTION,  match: { methodFullNamePattern: /^subprocess\.(call|run|Popen|check_output)/, shellArgRequired: true } },
    { id: 'eval',              vulnClass: VulnClass.DESERIALIZATION,    match: { methodFullNamePattern: /^(eval|exec|compile)$/ } },
    { id: 'pickle-loads',      vulnClass: VulnClass.DESERIALIZATION,    match: { methodFullNamePattern: /^(pickle|cPickle)\.(loads|load)$/ } },
    { id: 'open-path',         vulnClass: VulnClass.PATH_TRAVERSAL,     match: { methodFullNamePattern: /^(open|pathlib\.Path)$/ } },
    { id: 'requests-get',      vulnClass: VulnClass.SSRF,              match: { methodFullNamePattern: /^requests\.(get|post|put|patch|delete|request)$/ } },
    { id: 'flask-render',      vulnClass: VulnClass.XSS,              match: { methodFullNamePattern: /^(render_template_string|Markup)$/ } },
  ],
  sanitizers: [
    { id: 'sql-param',    coversVulnClass: [VulnClass.SQL_INJECTION],     match: { methodFullNamePattern: /^(re\.escape|html\.escape|bleach\.clean)/ } },
    { id: 'shlex-quote',  coversVulnClass: [VulnClass.COMMAND_INJECTION], match: { methodFullNamePattern: /^shlex\.quote$/ } },
  ],
};
```

---

## 6. Non-Taint Code Quality Detectors

Beyond taint flow, several structural/pattern analyses can be expressed as CPG queries. These are implemented as a `QualityPass` and emit `FINDING` nodes with severity `INFO` or `LOW`.

### 6.1 Dead Code Detection

**Algorithm:** Find METHOD nodes with no incoming `CALL` edges and no `SOURCE_FILE` registration as an export.

```cypher
MATCH (m:METHOD)
WHERE NOT EXISTS { MATCH ()-[:CALL]->(m) }
  AND NOT m.name IN ['main', '__init__', 'index', 'activate', 'deactivate']
  AND NOT m.isExported = true
RETURN m.name, m.filename, m.lineNumber
```

Reference: CFG-based dead code is unreachable code within a function — nodes with no incoming `CFG` edges (other than METHOD entry). Joern supports this via `DOMINATE`/`POST_DOMINATE` edges, which we have in our schema but have not yet populated — see [[../../../.tmp/codepropertygraph/schema/src/main/scala/io/shiftleft/codepropertygraph/schema/Dominators.scala]].

### 6.2 Overly Complex Functions (Cyclomatic Complexity)

**Algorithm:** Cyclomatic complexity = (number of branches) - (number of RETURN/exits) + 2. Approximate via counting CONTROL_STRUCTURE nodes in a method.

```cypher
MATCH (m:METHOD)-[:CONTAINS]->(cs:CONTROL_STRUCTURE)
WITH m, count(cs) AS branches
WHERE branches > 10
RETURN m.name, m.filename, m.lineNumber, branches
ORDER BY branches DESC
```

Emit a FINDING with `ruleId: 'HIGH_CYCLOMATIC_COMPLEXITY'` and severity `LOW`.

### 6.3 Long Parameter Lists

```cypher
MATCH (m:METHOD)-[:AST]->(p:METHOD_PARAMETER_IN)
WITH m, count(p) AS paramCount
WHERE paramCount > 5
RETURN m.name, m.filename, paramCount
```

### 6.4 Deep Nesting

**Algorithm:** Measure AST depth of CONTROL_STRUCTURE nodes within a METHOD.

```cypher
MATCH path = (m:METHOD)-[:AST*]->(inner:CONTROL_STRUCTURE)
WITH m, inner, length(path) AS depth
WHERE depth > 6
RETURN m.name, inner.lineNumber, depth
ORDER BY depth DESC
```

### 6.5 Hardcoded Credentials / Secrets

**Algorithm:** Find LITERAL nodes whose code matches patterns for secrets, assigned to LOCAL/IDENTIFIER whose name suggests a credential.

```cypher
MATCH (id:IDENTIFIER)-[:REF]->(local:LOCAL)
WHERE local.name =~ '(?i).*(password|passwd|secret|api_key|token|credential|private_key).*'
MATCH (id)<-[:REACHING_DEF]-(lit:LITERAL)
WHERE lit.code =~ '^["\'](?!\\$\\{).{8,}["\']$'
RETURN local.name, lit.code, lit.lineNumber, lit.filename
```

Severity: `CRITICAL` — hardcoded secrets are always a direct vulnerability.

### 6.6 Prototype Pollution

**Algorithm:** Find `Object.assign` or spread calls where the second argument is tainted.

```cypher
MATCH (call:CALL)
WHERE call.methodFullName =~ '.*Object\.assign.*'
MATCH (call)<-[:ARGUMENT]-(arg:IDENTIFIER {argumentIndex: 1})
WHERE EXISTS {
  MATCH (src:TAINT_SOURCE)-[:REACHING_DEF*1..8]->(arg)
}
RETURN call.filename, call.lineNumber
```

### 6.7 Insecure Randomness

**Algorithm:** Find `Math.random()` calls in security contexts (token generation, ID assignment).

```cypher
MATCH (call:CALL)
WHERE call.methodFullName = 'Math.random'
MATCH (call)-[:REACHING_DEF]->(id:IDENTIFIER)
WHERE id.name =~ '(?i).*(token|id|session|nonce|key|salt).*'
RETURN call.filename, call.lineNumber
```

### 6.8 Missing Error Handling

**Algorithm:** Find CALL nodes in `try` blocks where the `catch` block is empty or only contains a comment.

```cypher
MATCH (cs:CONTROL_STRUCTURE {controlStructureType: 'TRY'})
      -[:CATCH_BODY]->(catchBlock:BLOCK)
WHERE NOT EXISTS { MATCH (catchBlock)-[:AST]->(:CALL) }
  AND NOT EXISTS { MATCH (catchBlock)-[:AST]->(:IDENTIFIER) }
RETURN cs.filename, cs.lineNumber
```

### 6.9 Type Confusion (TypeScript)

**Algorithm:** Find `as any` casts followed by property accesses — signals intentional type erasure.

```cypher
MATCH (tr:TYPE_REF {typeFullName: 'ANY'})
      -[:REACHING_DEF]->(call:CALL)
WHERE call.methodFullName =~ '.*\\..*'
RETURN tr.filename, tr.lineNumber, call.methodFullName
```

---

## 7. AI Agent Integration

The entire point of emitting `FINDING` nodes is to give an AI coding agent structured, graph-grounded evidence. Here is how the agent consumes findings:

### 7.1 Finding Schema for Agent Context

```typescript
interface AgentFinding {
  id:          string;           // unique finding ID
  ruleId:      string;           // e.g. SQL_INJECTION
  severity:    Severity;         // CRITICAL | HIGH | MEDIUM | LOW | INFO
  message:     string;           // human-readable description
  filename:    string;           // file path
  lineNumber:  number;           // sink line
  columnNumber?: number;
  
  // The taint path — ordered list of nodes from source to sink
  flowPath: FlowPathNode[];      
  
  // Suggested fix (populated by AI agent or rule)
  suggestion?: string;
  
  // CPG context for the AI
  sourceNode:  CpgNodeSummary;   // the untrusted input origin
  sinkNode:    CpgNodeSummary;   // the dangerous operation
  methodContext: {               // enclosing method info
    name: string;
    filename: string;
    lineNumber: number;
    paramCount: number;
  };
}

interface FlowPathNode {
  nodeId:    string;
  nodeType:  string;
  code:      string;
  lineNumber: number;
  variable:  string;   // the REACHING_DEF variable at this hop
}
```

### 7.2 Querying Findings for Agent Prompts

```cypher
-- Get all findings for a file, with full flow paths
MATCH (f:FINDING)-[:FLOWS_TO]->(n)
WHERE f.filename = $filename
WITH f, collect(n ORDER BY n.order) AS path
RETURN f.ruleId, f.severity, f.message, f.lineNumber,
       [node IN path | {code: node.code, line: node.lineNumber, type: labels(node)[0]}] AS flowPath
ORDER BY f.severity DESC
```

### 7.3 Agent Prompt Template (per finding)

The `DetailsViewProvider` or a dedicated `FindingsProvider` can format findings into structured context blocks:

```
## Security Finding: SQL_INJECTION [CRITICAL]
File: src/services/UserService.ts:42

The value from `req.query.userId` (line 18) flows unsanitized into a database
query (line 42) via:

  line 18: req.query.userId   → [HTTP_PARAM source]
  line 23: userId = req.query.userId   → REACHING_DEF (variable: userId)
  line 41: const sql = `SELECT * FROM users WHERE id = ${userId}`   → REACHING_DEF (variable: sql)
  line 42: db.query(sql)   → [SQL_INJECTION sink]

Suggested fix: Use a parameterized query:
  db.query('SELECT * FROM users WHERE id = ?', [userId])
```

### 7.4 Aggregate Quality Dashboard Query

```cypher
MATCH (f:FINDING)
RETURN f.ruleId        AS rule,
       f.severity      AS severity,
       count(f)        AS count,
       collect(DISTINCT f.filename) AS affectedFiles
ORDER BY
  CASE f.severity
    WHEN 'CRITICAL' THEN 1
    WHEN 'HIGH'     THEN 2
    WHEN 'MEDIUM'   THEN 3
    WHEN 'LOW'      THEN 4
    ELSE 5
  END
```

---

## 8. Pipeline Integration

### 8.1 Updated CpgPipeline

```
processFile(filePath, source):
  1. Parse        → tree
  2. UastBuilder  → nodes + AST edges
  3. CfgBuilder   → CFG edges + METHOD_RETURN nodes
  4. PdgBuilder   → REACHING_DEF + CDG edges
  5. TaintPass    → TAINT_SOURCE + TAINT_SINK + SANITIZER + TAINT_FLOW edges
  6. QualityPass  → structural FINDING nodes (complexity, dead code, etc.)
  7. replaceFileSubgraph (atomic swap in FalkorDB)
  8. emit 'findings:updated' event → GraphViewProvider refresh
```

Steps 5 and 6 can run in parallel since they read the PDG but do not modify it.

### 8.2 Incremental Re-analysis

When a file changes, the `DiffEngine` detects it and triggers `CpgPipeline.processFile`. Because `FINDING` nodes are stored in the same subgraph as their evidence nodes, `replaceFileSubgraph` automatically clears stale findings and replaces them with fresh ones. No separate invalidation step needed.

---

## 9. New Files

```
src/graph/cpg/taint/
  TaintPass.ts          — main taint propagation pass
  QualityPass.ts        — structural quality checks
  TaintRuleSet.ts       — types for rules
  rules/
    typescript.rules.ts
    python.rules.ts
    shared.rules.ts     — language-agnostic rules (hardcoded secrets, etc.)

src/providers/
  FindingsViewProvider.ts  — VS Code webview panel listing all findings

src/services/storage/cypher/
  taintQueries.ts       — taint-specific Cypher queries
  qualityQueries.ts     — quality-specific Cypher queries
```

---

## 10. Implementation Phases

### Phase 1: Source/Sink Tagging (no path tracking)

- Add `TAINT_SOURCE`, `TAINT_SINK`, `SANITIZER` node types to schema
- Implement source/sink identification in `TaintPass` (pattern matching against CALL `methodFullName`)
- Emit basic `FINDING` nodes (source + sink, no path) for SQL injection, command injection, path traversal
- Write Cypher queries for basic source→sink reachability (does a REACHING_DEF path exist?)
- Add findings to FalkorDB and surface count in `GraphViewProvider`

### Phase 2: Full Taint Path Reconstruction

- Implement backward/forward slice via Cypher `REACHING_DEF*` traversal
- Populate `TAINT_FLOW` edges and `FLOWS_TO` edges for each FINDING
- Include `flowPath` in FINDING node properties as serialized JSON
- Add `FindingsViewProvider` panel with collapsible taint path per finding
- Add sanitizer awareness — prune flows that pass through a sanitizer

### Phase 3: Quality Detectors

- Implement `QualityPass` with dead code, complexity, nesting depth, hardcoded secrets
- Add long parameter list, insecure randomness, missing error handling detectors
- Wire all FINDING nodes into `FindingsViewProvider`

### Phase 4: AI Agent Context API

- Add `getFindings(filename)` method to `FalkorDBStore`
- Implement finding formatter for AI prompt injection in `DetailsViewProvider`
- Structure the findings as an MCP tool response so an agent can query findings by file/rule/severity
- Add one-click "explain & fix" command that sends a finding's full context to the AI

---

## 11. Key Design Decisions

**Why graph reachability vs. abstract interpretation?**  
Abstract interpretation is more precise but requires type inference infrastructure we don't have. Graph reachability over `REACHING_DEF` edges is exactly what Joern uses and is well-suited to our FalkorDB backend. The Cypher `REACHING_DEF*1..N` pattern with a bounded depth (typically 10–20 hops) prevents infinite traversals and is fast enough for interactive use.

**Why store findings in FalkorDB alongside the CPG?**  
Co-locating findings with their evidence nodes means a single Cypher query can return both the finding metadata and the full taint path. It also means `replaceFileSubgraph` atomically clears stale findings on re-parse — no separate finding cache to invalidate.

**Why per-language rule files vs. a unified rule engine?**  
Languages differ significantly in their source/sink naming (e.g., Flask vs. Express vs. Rails). A unified rule engine would require a mapping layer that adds complexity. Per-language rule files are simpler, testable, and easy for contributors to extend.

**Sanitizer-class awareness:**  
A SQL escape function does not protect against command injection. Each sanitizer rule specifies `coversVulnClass[]` so the taint pass can track which vulnerability classes have been mitigated for a given data flow independently.
