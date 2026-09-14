import { z } from "zod";

/**
 * Request contracts for the API.
 *
 * Every message is written out rather than left to the default formatter,
 * because these are the only errors a caller can act on without reading the
 * source, and because a broker should say precisely which field it refused.
 *
 * Absent fields take deny-safe defaults: the empty bucket and prefix match no
 * grant, permission falls back to `read`, and both widening flags default off.
 * Nothing is coerced, so a wrong type is a 400 rather than a silently
 * reinterpreted request.
 */

const TTL_MESSAGE = "ttlSeconds must be a positive integer.";

export const credentialRequestSchema = z.object({
	bucket: z.string({ error: "bucket must be a string." }).default(""),
	prefix: z.string({ error: "prefix must be a string." }).default(""),
	permission: z.enum(["read", "write"], { error: 'permission must be "read" or "write".' }).default("read"),
	ttlSeconds: z
		.number({ error: TTL_MESSAGE })
		.refine((value) => Number.isSafeInteger(value) && value > 0, TTL_MESSAGE)
		.optional(),
	/** Union every prefix held in the bucket into one credential. Strictly wider. */
	allPrefixes: z.boolean({ error: "allPrefixes must be a boolean." }).default(false),
	/** Only honoured where policy already permits delete. Never grants it. */
	includeDelete: z.boolean({ error: "includeDelete must be a boolean." }).default(false),
});

export type CredentialRequest = z.infer<typeof credentialRequestSchema>;

export const listQuerySchema = z.object({
	bucket: z.string().default(""),
	prefix: z.string().default(""),
	cursor: z.string().optional(),
});

export const objectQuerySchema = z.object({
	bucket: z.string().default(""),
	key: z.string().default(""),
});
