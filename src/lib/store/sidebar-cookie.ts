/**
 * Cookie holding the sidebar preference, read on the server so pages load in the right state.
 * Kept out of the "use client" store: a server component importing from a client module gets a
 * client reference, not this string.
 */
export const SIDEBAR_COOKIE = "sidebar_state";
