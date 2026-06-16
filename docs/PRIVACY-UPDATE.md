## Privacy policy updated

TinyTinkerer added an optional **Browser state** plugin. It is off by default; you enable it in
Settings → Plugins.

When enabled, it gives the assistant a `read_dom` tool that can read the page you are currently
viewing — through narrow CSS-selector queries, never the whole page at once — so it can answer
questions about what is on screen and debug rendering issues. Whatever it reads is sent to the
model provider as part of that chat turn, the same path your conversation already takes. The tool
can surface content that is on the page but that you have not yet sent as a message, and the host
redacts form-field values (inputs, text areas, and password fields) before returning, so text you
have typed but not sent is not included.

If the plugin is disabled, the `read_dom` tool is not available and no page content is read. See
the new "Browser state plugin (read_dom)" section of the privacy policy for details.
