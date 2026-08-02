/**
 * The pre-send disclosure's data shape and storage key (issue #481).
 *
 * Split out from `pre-send-disclosure.ts` for one reason: `app.ts` needs exactly
 * these two things — the type, which erases, and the preference key it reads
 * during bootstrap — while the gate's store, hooks and dialog are things only a
 * chat surface ever touches. `app.ts` is imported by every shell's startup
 * entry, and `apps/shell`'s entry budget is enforced to the kilobyte, so
 * importing the store module for a string constant would put the whole gate in
 * every product endpoint's startup path for a capability none of them uses.
 *
 * `pre-send-disclosure.ts` re-exports both, so consumers still have one place to
 * import from.
 */

/**
 * Where the acknowledgement is written. Per storage namespace, like every other
 * preference — which is what makes this an app-scoped acknowledgement rather
 * than a document-global one.
 */
export const PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY = 'pre_send_disclosure_acknowledged_version'

/**
 * What the gate says. Pure data, so the same content renders in the one-time
 * dialog, in the Settings → Privacy section, and in any test that wants to assert
 * the copy without mounting anything.
 */
export type PreSendDisclosure = {
  /**
   * Bumped whenever the disclosed data flow changes. A reader who acknowledged
   * an older version is asked again; matching versions never prompt.
   */
  version: string
  title: string
  /** The disclosure itself. Rendered as paragraphs, in order. */
  paragraphs: readonly string[]
  /**
   * An optional route to the fuller story, offered beside the accept action.
   *
   * `target` rather than a host callback, and `privacy-policy` is the only one:
   * the generated policy is this package's own artifact, so the host can open it
   * in place. A host-supplied callback would have to navigate — which on a
   * documentation site means losing the message still sitting in the composer,
   * the one thing this gate exists to preserve.
   */
  learnMore?: { label: string; target: 'privacy-policy' }
  acceptLabel?: string
  cancelLabel?: string
}
