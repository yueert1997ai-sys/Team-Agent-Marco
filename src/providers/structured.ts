import { ProviderError } from "./errors.js";

interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
}

export function parseAndValidateStructured<T>(
  provider: string,
  raw: string,
  schema: Record<string, unknown>
): T {
  const candidate = extractJson(raw);
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch (error) {
    throw new ProviderError(`${provider} returned malformed structured output`, provider, undefined, true, {
      raw: truncate(raw, 1000),
      error
    });
  }

  const errors: string[] = [];
  validateValue(value, schema as JsonSchema, "$", errors);
  if (errors.length > 0) {
    throw new ProviderError(
      `${provider} structured output failed validation: ${errors.slice(0, 6).join("; ")}`,
      provider,
      undefined,
      true,
      value
    );
  }
  return value as T;
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1);

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1);

  return trimmed;
}

function validateValue(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    return;
  }

  switch (schema.type) {
    case "object": {
      if (!isRecord(value)) {
        errors.push(`${path} must be an object`);
        return;
      }
      for (const key of schema.required ?? []) {
        if (!(key in value)) errors.push(`${path}.${key} is required`);
      }
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (key in value) validateValue(value[key], childSchema, `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false && schema.properties) {
        for (const key of Object.keys(value)) {
          if (!(key in schema.properties)) errors.push(`${path}.${key} is not allowed`);
        }
      }
      return;
    }
    case "array":
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array`);
        return;
      }
      if (schema.items) value.forEach((item, index) => validateValue(item, schema.items!, `${path}[${index}]`, errors));
      return;
    case "string":
      if (typeof value !== "string") errors.push(`${path} must be a string`);
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${path} must be a finite number`);
        return;
      }
      if (schema.minimum != null && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
      if (schema.maximum != null && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
      return;
    case "integer":
      if (!Number.isInteger(value)) errors.push(`${path} must be an integer`);
      return;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
      return;
    default:
      return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}
