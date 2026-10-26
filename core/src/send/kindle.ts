// Send to Kindle by email. Magpie opens a new message in the person's own
// Mail with the books attached and the Kindle address filled in (Host.mail).
// They press Send; nothing leaves the Mac without them.

/** Amazon's limit for one Send to Kindle email, attachments included. */
export const KINDLE_LIMIT = 50 * 1024 * 1024;
