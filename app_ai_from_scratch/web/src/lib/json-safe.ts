// Serializer for data embedded in a `<script type="application/json">` block.
//
// Astro's `set:html` does not escape, and `JSON.stringify` does not escape "<".
// HTML end-tag matching is case-insensitive and happens before any JSON parsing,
// so a value holding "</script>" (or "</SCRIPT>") closes the element early and
// the browser parses whatever follows as markup. Any string that reaches one of
// these blobs from the database or from a model response is therefore an XSS
// vector in the authenticated origin.
//
// "<" is the same character to any JSON parser and inert to the HTML
// parser, so escaping every "<" keeps the data intact and the element closed.
// Escaping the whole class of "<" (rather than the literal "</script>") also
// covers "<!--", which would otherwise put the parser in a comment state.
export const jsonSafe = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
