/**
 * Test helper for building a #476 page-context publication.
 *
 * `DocsPageSnapshotInput` carries the resolution AND the routing input it came
 * from, plus a resolver for arbitrary routes (issue #480 re-review, finding 4).
 * Most suites only ever publish one route and care about nothing else, so this
 * fills in the two route fields with the obvious defaults.
 */
import type { DocsPageResolution } from '../active-document'
import type { DocsPageSnapshotInput } from '../page-snapshot'

type PublicationInput = Omit<DocsPageSnapshotInput, 'route' | 'resolveRoute'> &
  Partial<Pick<DocsPageSnapshotInput, 'route' | 'resolveRoute'>>

export const asPublication = (input: PublicationInput): DocsPageSnapshotInput => ({
  ...input,
  route: input.route ?? { pathname: input.pathname },
  /**
   * Default: this publication answers the same way whatever route it is asked
   * about — indistinguishable from the real thing for a suite that publishes a
   * single route. A suite about the run pin supplies a corpus-backed resolver
   * instead, which is what makes "resolve the route I pinned, not the route the
   * reader is on now" observable.
   */
  resolveRoute: input.resolveRoute ?? ((): DocsPageResolution => input)
})
