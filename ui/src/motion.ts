// Motion that holds up a step (an accepted suggestion settling before the
// next book, a sheet lifting away) waits only when people want motion.

/** True when the Mac is set to Reduce Motion. */
export const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Waits for an animation of `ms` to play, or not at all under Reduce Motion. */
export const settle = (ms: number) => new Promise<void>((r) => (still() ? r() : setTimeout(r, ms)));
