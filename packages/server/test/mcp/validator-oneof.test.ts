import { describe, expect, it } from "bun:test";
import {
  ValidationError,
  validateArgs,
  type ToolDef,
} from "../../src/mcp/tools";

// Synthetic tools that exercise the new validator features without depending
// on the production TOOLS array (so adding a new tool downstream can't break
// this suite, and so we don't need a DB).

const oneOfShorthand: ToolDef = {
  name: "fixture_oneof_shorthand",
  description: "fixture",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string" },
      diagramId: { type: "string" },
      cascade: { type: "boolean" },
    },
    oneOf: ["slug", "diagramId"],
  },
  run: async () => ({ ok: true }),
};

const oneOfJsonSchemaForm: ToolDef = {
  name: "fixture_oneof_jsonschema",
  description: "fixture",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string" },
      diagramId: { type: "string" },
    },
    oneOf: [{ required: ["slug"] }, { required: ["diagramId"] }],
  },
  run: async () => ({ ok: true }),
};

const mxTool: ToolDef = {
  name: "fixture_mutually_exclusive",
  description: "fixture",
  inputSchema: {
    type: "object",
    properties: {
      targetNodes: { type: "array" },
      bboxData: { type: "object" },
      body: { type: "string" },
    },
    required: ["body"],
    mutuallyExclusive: [["targetNodes", "bboxData"]],
  },
  run: async () => ({ ok: true }),
};

const oneOfWithAlias: ToolDef = {
  name: "fixture_oneof_alias",
  description: "fixture",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string" },
      diagramId: { type: "string" },
    },
    oneOf: ["slug", "diagramId"],
  },
  // Some tools accept `name` as a legacy alias for `slug`.
  legacyAliases: { name: "slug" },
  run: async () => ({ ok: true }),
};

describe("validateArgs — oneOf (shorthand array form)", () => {
  it("accepts a single member of the oneOf set", () => {
    expect(() => validateArgs(oneOfShorthand, { slug: "foo" })).not.toThrow();
    expect(() => validateArgs(oneOfShorthand, { diagramId: "d_x" })).not.toThrow();
  });

  it("rejects with missing_required_parameter when none of the oneOf members are present", () => {
    try {
      validateArgs(oneOfShorthand, { cascade: true });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("missing_required_parameter");
      expect((e as ValidationError).message).toMatch(/Exactly one of \[slug, diagramId\]/);
      expect((e as ValidationError).message).toMatch(/none were supplied/);
    }
  });

  it("rejects with mutually_exclusive_parameters when two oneOf members are present", () => {
    try {
      validateArgs(oneOfShorthand, { slug: "foo", diagramId: "d_x" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("mutually_exclusive_parameters");
      expect((e as ValidationError).message).toMatch(/multiple were supplied/);
      expect((e as ValidationError).message).toMatch(/slug, diagramId/);
    }
  });

  it("counts an alias toward its canonical field for oneOf presence", () => {
    // `name` is the legacy alias for `slug`. Supplying just `name` satisfies
    // the oneOf — no throw.
    expect(() => validateArgs(oneOfWithAlias, { name: "foo" })).not.toThrow();
    // Supplying both `name` (= slug) and `diagramId` is rejected.
    expect(() =>
      validateArgs(oneOfWithAlias, { name: "foo", diagramId: "d_x" }),
    ).toThrow(/multiple were supplied/);
  });
});

describe("validateArgs — oneOf (JSON-Schema { required } branches)", () => {
  it("accepts a single branch", () => {
    expect(() =>
      validateArgs(oneOfJsonSchemaForm, { slug: "foo" }),
    ).not.toThrow();
  });

  it("rejects when no branch is satisfied", () => {
    expect(() => validateArgs(oneOfJsonSchemaForm, {})).toThrow(
      /Exactly one of \[slug, diagramId\]/,
    );
  });

  it("rejects when both branches are satisfied", () => {
    expect(() =>
      validateArgs(oneOfJsonSchemaForm, { slug: "foo", diagramId: "d_x" }),
    ).toThrow(/multiple were supplied/);
  });
});

describe("validateArgs — mutuallyExclusive", () => {
  it("accepts when only one of the mutex group is present", () => {
    expect(() =>
      validateArgs(mxTool, { body: "hi", targetNodes: ["n1"] }),
    ).not.toThrow();
    expect(() =>
      validateArgs(mxTool, { body: "hi", bboxData: { x: 0, y: 0, w: 1, h: 1 } }),
    ).not.toThrow();
  });

  it("accepts when none of the mutex group is present", () => {
    expect(() => validateArgs(mxTool, { body: "hi" })).not.toThrow();
  });

  it("rejects when two members of the mutex group are present", () => {
    try {
      validateArgs(mxTool, {
        body: "hi",
        targetNodes: ["n1"],
        bboxData: { x: 0, y: 0, w: 1, h: 1 },
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("mutually_exclusive_parameters");
      expect((e as ValidationError).message).toMatch(/cannot be supplied together/);
      expect((e as ValidationError).message).toMatch(/targetNodes, bboxData/);
    }
  });

  it("respects the existing required-field check before reaching mutex", () => {
    expect(() =>
      validateArgs(mxTool, { targetNodes: ["n1"], bboxData: { x: 0, y: 0, w: 1, h: 1 } }),
    ).toThrow(/Missing required parameter: body/);
  });
});
