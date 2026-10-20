import { z } from 'zod';
export const cellValue = z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null(), z.strictObject({ formula: z.string().min(2).max(10000).startsWith('=') }), z.strictObject({ date: z.iso.datetime({ offset: true }) })]);
export const fieldValue = z.union([z.string().max(100000), z.number().finite(), z.boolean(), z.null(), z.strictObject({ formula: z.string().min(2).max(10000).startsWith('=') }), z.strictObject({ date: z.iso.datetime({ offset: true }) })]);
const integer = z.number().int().positive();
const target = z.strictObject({ kind: z.enum(['body', 'section', 'page', 'text', 'shape']), index: integer.optional() }).refine(t => t.kind === 'body' ? t.index === undefined : t.index !== undefined, 'Supply an index for non-body targets only.');
export const binding = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), target: target.default({ kind: 'body' }), find: z.string().min(1).max(10000), expected_count: integer.max(200).default(1) }),
  z.strictObject({ kind: z.literal('placeholder'), tag: z.string().min(1).max(4096), expected_count: integer.max(200).default(1) }),
  z.strictObject({ kind: z.literal('cell'), table: integer, table_name: z.string().min(1).max(4096), address: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]*$/), preserve_format: z.boolean().default(true) })
]);
export const compositionField = z.strictObject({ name: z.string().min(1).max(512), required: z.boolean().default(true), value: fieldValue.optional(), default: fieldValue.optional(), bindings: z.array(binding).min(1).max(20) });
export const definitionField = compositionField.omit({ value: true });
export const recipeName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const recipeDefinition = z.strictObject({ source_path: z.string().min(1).max(4096), description: z.string().max(4000).default(''), fields: z.array(definitionField).min(1).max(100) });
export const storedRecipe = z.strictObject({ schema_version: z.literal(1), name: recipeName, version: integer, description: z.string().max(4000), source: z.strictObject({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }), fields: z.array(definitionField).min(1).max(100) });
