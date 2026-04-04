import { describe, test, expect } from "bun:test";
import {
  serializeValue,
  serializeProperties,
  safeCpgLabel,
  buildBatchNodeCypher,
  buildBatchEdgeCypher,
} from "../../../../../src/services/storage/cypher/queries";
import type { CpgNode, CpgEdge } from "../../../../../src/types/cpg";

// ---------------------------------------------------------------------------
// serializeValue
// ---------------------------------------------------------------------------
describe("serializeValue", () => {
  test("wraps a plain string in double quotes", () => {
    expect(serializeValue("hello")).toBe('"hello"');
  });

  test("does not escape backslashes (only double-quotes are escaped)", () => {
    // serializeValue only replaces " → \" — backslashes pass through unchanged
    expect(serializeValue("C:\\Users\\foo")).toBe('"C:\\Users\\foo"');
  });

  test("escapes double-quote characters inside strings", () => {
    expect(serializeValue('say "hi"')).toBe('"say \\"hi\\""');
  });

  test("does not additionally escape single quotes (passthrough)", () => {
    // Single quotes are valid inside Cypher double-quoted strings
    expect(serializeValue("it's fine")).toBe('"it\'s fine"');
  });

  test("integer: returns digits only, no quotes", () => {
    expect(serializeValue(42)).toBe("42");
  });

  test("negative integer: returned correctly", () => {
    expect(serializeValue(-7)).toBe("-7");
  });

  test("float: returned as-is without quotes", () => {
    expect(serializeValue(3.14)).toBe("3.14");
  });

  test("boolean true: returns 'true' without quotes", () => {
    expect(serializeValue(true)).toBe("true");
  });

  test("boolean false: returns 'false' without quotes", () => {
    expect(serializeValue(false)).toBe("false");
  });

  test("null: returns 'null'", () => {
    expect(serializeValue(null)).toBe("null");
  });

  test("undefined: returns 'null'", () => {
    expect(serializeValue(undefined)).toBe("null");
  });

  test("empty string: returns double-quoted empty string", () => {
    expect(serializeValue("")).toBe('""');
  });

  test("string with newline character: newline is preserved inside the value", () => {
    // The function does not escape \n — it just wraps in double quotes.
    // Verify the output is still a quoted string containing the newline.
    const result = serializeValue("line1\nline2");
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  test("string with parentheses, brackets and colons: no breakage", () => {
    const tricky = "fn(a: [1, 2])";
    const result = serializeValue(tricky);
    expect(result).toBe('"fn(a: [1, 2])"');
  });

  test("zero: returned without quotes", () => {
    expect(serializeValue(0)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// serializeProperties
// ---------------------------------------------------------------------------
describe("serializeProperties", () => {
  test("single string property is wrapped correctly", () => {
    expect(serializeProperties({ key: "value" })).toBe('{key: "value"}');
  });

  test("multiple properties are all included", () => {
    const result = serializeProperties({ a: "x", b: "y" });
    expect(result).toContain('a: "x"');
    expect(result).toContain('b: "y"');
    expect(result.startsWith("{")).toBe(true);
    expect(result.endsWith("}")).toBe(true);
  });

  test("numeric value is not quoted", () => {
    expect(serializeProperties({ count: 42 })).toBe("{count: 42}");
  });

  test("boolean false value is serialized correctly", () => {
    expect(serializeProperties({ isExternal: false })).toBe(
      "{isExternal: false}"
    );
  });

  test("boolean true value is serialized correctly", () => {
    expect(serializeProperties({ active: true })).toBe("{active: true}");
  });

  test("null value is included as 'null'", () => {
    // serializeValue(null) → 'null'; serializeProperties does not skip nulls
    expect(serializeProperties({ missing: null })).toBe("{missing: null}");
  });

  test("undefined value is included as 'null'", () => {
    expect(serializeProperties({ optional: undefined })).toBe(
      "{optional: null}"
    );
  });

  test("empty object returns '{}'", () => {
    expect(serializeProperties({})).toBe("{}");
  });

  test("mixed types all appear in output", () => {
    const result = serializeProperties({
      name: "myMethod",
      lineNumber: 10,
      isExternal: true,
    });
    expect(result).toContain('name: "myMethod"');
    expect(result).toContain("lineNumber: 10");
    expect(result).toContain("isExternal: true");
  });
});

// ---------------------------------------------------------------------------
// safeCpgLabel
// ---------------------------------------------------------------------------
describe("safeCpgLabel", () => {
  test("METHOD passes through unchanged", () => {
    expect(safeCpgLabel("METHOD")).toBe("METHOD");
  });

  test("TYPE_DECL passes through unchanged", () => {
    expect(safeCpgLabel("TYPE_DECL")).toBe("TYPE_DECL");
  });

  test("FILE passes through unchanged", () => {
    expect(safeCpgLabel("FILE")).toBe("FILE");
  });

  test("CALL passes through unchanged", () => {
    expect(safeCpgLabel("CALL")).toBe("CALL");
  });

  test("IDENTIFIER passes through unchanged", () => {
    expect(safeCpgLabel("IDENTIFIER")).toBe("IDENTIFIER");
  });

  test("LITERAL passes through unchanged", () => {
    expect(safeCpgLabel("LITERAL")).toBe("LITERAL");
  });

  test("BLOCK passes through unchanged", () => {
    expect(safeCpgLabel("BLOCK")).toBe("BLOCK");
  });

  test("CONTROL_STRUCTURE passes through unchanged", () => {
    expect(safeCpgLabel("CONTROL_STRUCTURE")).toBe("CONTROL_STRUCTURE");
  });

  test("NAMESPACE_BLOCK passes through unchanged", () => {
    expect(safeCpgLabel("NAMESPACE_BLOCK")).toBe("NAMESPACE_BLOCK");
  });

  test("METHOD_PARAMETER_IN passes through unchanged", () => {
    expect(safeCpgLabel("METHOD_PARAMETER_IN")).toBe("METHOD_PARAMETER_IN");
  });

  test("METHOD_RETURN passes through unchanged", () => {
    expect(safeCpgLabel("METHOD_RETURN")).toBe("METHOD_RETURN");
  });

  test("UNKNOWN passes through unchanged", () => {
    expect(safeCpgLabel("UNKNOWN")).toBe("UNKNOWN");
  });

  test("DIRECTORY passes through unchanged (filesystem label)", () => {
    expect(safeCpgLabel("DIRECTORY")).toBe("DIRECTORY");
  });

  test("ANNOTATION passes through unchanged", () => {
    expect(safeCpgLabel("ANNOTATION")).toBe("ANNOTATION");
  });

  test("FINDING passes through unchanged", () => {
    expect(safeCpgLabel("FINDING")).toBe("FINDING");
  });

  test("invalid label falls back to 'CPG'", () => {
    expect(safeCpgLabel("NOT_A_REAL_LABEL")).toBe("CPG");
  });

  test("empty string falls back to 'CPG'", () => {
    expect(safeCpgLabel("")).toBe("CPG");
  });

  test("lowercase label falls back to 'CPG' (labels are case-sensitive)", () => {
    expect(safeCpgLabel("method")).toBe("CPG");
  });
});

// ---------------------------------------------------------------------------
// buildBatchNodeCypher
// ---------------------------------------------------------------------------
describe("buildBatchNodeCypher", () => {
  const makeNode = (overrides: Partial<CpgNode> = {}): CpgNode => ({
    id: "node-1",
    label: "METHOD",
    name: "myMethod",
    ...overrides,
  });

  test("empty array produces empty array", () => {
    expect(buildBatchNodeCypher([])).toEqual([]);
  });

  test("single node produces an array with exactly one string", () => {
    const result = buildBatchNodeCypher([makeNode()]);
    expect(result).toHaveLength(1);
  });

  test("uses MERGE not CREATE for idempotency", () => {
    const [stmt] = buildBatchNodeCypher([makeNode()]);
    expect(stmt).toMatch(/^MERGE /i);
    expect(stmt).not.toMatch(/\bCREATE\b/i);
  });

  test("includes the node label in the statement", () => {
    const [stmt] = buildBatchNodeCypher([makeNode({ label: "CALL" })]);
    expect(stmt).toContain(":CALL");
  });

  test("uses the node's id as the lookup key inside MERGE", () => {
    const [stmt] = buildBatchNodeCypher([makeNode({ id: "abc-123" })]);
    expect(stmt).toContain('id: "abc-123"');
  });

  test("includes SET to update all properties", () => {
    const [stmt] = buildBatchNodeCypher([makeNode()]);
    expect(stmt).toContain("SET n +=");
  });

  test("serialized props include the node name", () => {
    const [stmt] = buildBatchNodeCypher([makeNode({ name: "doSomething" })]);
    expect(stmt).toContain('"doSomething"');
  });

  test("multiple nodes produce one statement per node", () => {
    const nodes = [
      makeNode({ id: "n1", label: "METHOD" }),
      makeNode({ id: "n2", label: "CALL" }),
      makeNode({ id: "n3", label: "IDENTIFIER" }),
    ];
    const result = buildBatchNodeCypher(nodes);
    expect(result).toHaveLength(3);
  });

  test("each statement in multi-node result targets the correct id", () => {
    const nodes = [
      makeNode({ id: "n1" }),
      makeNode({ id: "n2" }),
    ];
    const [stmt1, stmt2] = buildBatchNodeCypher(nodes);
    expect(stmt1).toContain('"n1"');
    expect(stmt2).toContain('"n2"');
  });

  test("double-quotes in node id are escaped", () => {
    const [stmt] = buildBatchNodeCypher([makeNode({ id: 'id"with"quotes' })]);
    // The escaped quote should appear, not a raw unescaped one inside the id
    expect(stmt).toContain('\\"with\\"');
  });

  test("node with invalid label falls back to CPG label", () => {
    const node = { id: "x", label: "NOT_REAL" } as unknown as CpgNode;
    const [stmt] = buildBatchNodeCypher([node]);
    expect(stmt).toContain(":CPG");
  });

  test("node with LITERAL label is emitted correctly", () => {
    const [stmt] = buildBatchNodeCypher([
      makeNode({ id: "lit-1", label: "LITERAL", code: "42" }),
    ]);
    expect(stmt).toContain(":LITERAL");
    expect(stmt).toContain('"42"');
  });
});

// ---------------------------------------------------------------------------
// buildBatchEdgeCypher
// ---------------------------------------------------------------------------
describe("buildBatchEdgeCypher", () => {
  const makeEdge = (overrides: Partial<CpgEdge> = {}): CpgEdge => ({
    source: "src-1",
    target: "tgt-1",
    type: "AST",
    ...overrides,
  });

  test("empty array produces empty array", () => {
    expect(buildBatchEdgeCypher([])).toEqual([]);
  });

  test("single edge produces an array with exactly one string", () => {
    const result = buildBatchEdgeCypher([makeEdge()]);
    expect(result).toHaveLength(1);
  });

  test("statement contains MATCH for source and target", () => {
    const [stmt] = buildBatchEdgeCypher([makeEdge()]);
    expect(stmt.match(/MATCH/g)?.length).toBeGreaterThanOrEqual(1);
    expect(stmt).toContain('"src-1"');
    expect(stmt).toContain('"tgt-1"');
  });

  test("statement uses MERGE for the relationship (idempotent)", () => {
    const [stmt] = buildBatchEdgeCypher([makeEdge()]);
    expect(stmt).toContain("MERGE");
  });

  test("edge type appears as the relationship type", () => {
    const [stmt] = buildBatchEdgeCypher([makeEdge({ type: "CFG" })]);
    expect(stmt).toContain("[:CFG");
  });

  test("REACHING_DEF edge type is emitted correctly", () => {
    const [stmt] = buildBatchEdgeCypher([makeEdge({ type: "REACHING_DEF" })]);
    expect(stmt).toContain("[:REACHING_DEF");
  });

  test("edge without variable property has no variable clause", () => {
    const [stmt] = buildBatchEdgeCypher([makeEdge()]);
    expect(stmt).not.toContain("variable");
  });

  test("edge with variable property includes it in the relationship", () => {
    const [stmt] = buildBatchEdgeCypher([
      makeEdge({ type: "REACHING_DEF", variable: "userInput" }),
    ]);
    expect(stmt).toContain('variable: "userInput"');
  });

  test("double-quotes in variable are escaped", () => {
    const [stmt] = buildBatchEdgeCypher([
      makeEdge({ type: "REACHING_DEF", variable: 'var"name' }),
    ]);
    expect(stmt).toContain('\\"name');
  });

  test("double-quotes in source id are escaped", () => {
    const [stmt] = buildBatchEdgeCypher([makeEdge({ source: 'src"bad' })]);
    expect(stmt).toContain('\\"bad');
  });

  test("double-quotes in target id are escaped", () => {
    const [stmt] = buildBatchEdgeCypher([makeEdge({ target: 'tgt"bad' })]);
    expect(stmt).toContain('\\"bad');
  });

  test("multiple edges produce one statement per edge", () => {
    const edges = [
      makeEdge({ source: "a", target: "b", type: "AST" }),
      makeEdge({ source: "b", target: "c", type: "CFG" }),
      makeEdge({ source: "c", target: "d", type: "CDG" }),
    ];
    const result = buildBatchEdgeCypher(edges);
    expect(result).toHaveLength(3);
  });

  test("each statement in multi-edge result targets the correct ids", () => {
    const edges = [
      makeEdge({ source: "s1", target: "t1" }),
      makeEdge({ source: "s2", target: "t2" }),
    ];
    const [stmt1, stmt2] = buildBatchEdgeCypher(edges);
    expect(stmt1).toContain('"s1"');
    expect(stmt1).toContain('"t1"');
    expect(stmt2).toContain('"s2"');
    expect(stmt2).toContain('"t2"');
  });
});
