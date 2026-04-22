/**
 * apikey-client.ts — OpenSubsonic apiKey-authentication flow.
 *
 * Uses the same zero-dep fetch client as `minimal-client.ts` but configured for
 * the `apiKeyAuthentication` OpenSubsonic extension. Call `ensureApiKeySupported`
 * once at startup to confirm the server supports it; it throws with a clear
 * message if it doesn't, so callers can fall back to token+salt.
 */

import { SubsonicClient, SubsonicError } from "./minimal-client.ts";

export async function createApiKeyClient(opts: {
    baseUrl: string;
    apiKey: string;
    clientName: string;
}) {
    const client = new SubsonicClient(opts);
    await ensureApiKeySupported(client);
    return client;
}

export async function ensureApiKeySupported(client: SubsonicClient): Promise<void> {
    // `getOpenSubsonicExtensions` is callable without auth per spec, but calling
    // it with apiKey first also validates the key against the server.
    try {
        const exts = await client.extensions();
        if (!exts.some((e) => e.name === "apiKeyAuthentication")) {
            throw new SubsonicError(
                42,
                "Server does not advertise `apiKeyAuthentication` extension. " +
                    "Use token+salt authentication instead.",
            );
        }
    } catch (err) {
        if (err instanceof SubsonicError && err.code === 43) {
            throw new SubsonicError(
                43,
                "Multiple conflicting auth mechanisms — do not send `u=` alongside `apiKey=`.",
                err.helpUrl,
            );
        }
        throw err;
    }
}
