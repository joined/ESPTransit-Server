import type { HafasClient } from "hafas-client";
import { createClient } from "hafas-client";
import type { HafasProfile } from "./config.js";

export async function createHafasClient(
    profile: HafasProfile,
    userAgent: string,
): Promise<HafasClient> {
    // hafas-client profiles export a named `profile` object
    const mod = await import(`hafas-client/p/${profile}/index.js`);
    const profileObj = mod.profile ?? mod.default;

    return createClient(profileObj, userAgent);
}
