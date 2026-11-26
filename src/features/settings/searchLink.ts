// The bar's search opens the Settings window on the window's own search: the text rides in the section the window is asked for
// (settings_window_open passes it as it is), and the window puts it in its search field (nav.ts settingsQuery). Pure.

const PREFIX = "search:";

/** The section that opens the Settings window searching for `query`. */
export const searchSection = (query: string): string => PREFIX + query;

/** The text a section carries for the window's search, or null for a page's own id. */
export const sectionQuery = (section: string): string | null => (section.startsWith(PREFIX) && section.length > PREFIX.length ? section.slice(PREFIX.length) : null);
