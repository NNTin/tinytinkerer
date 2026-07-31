/**
 * Public surface of the documentation assistant's grounding and citation policy
 * (issue #478).
 *
 * #479 imports `createDocumentationAssistantPolicy` and passes it to
 * `createBrowserApp(config, { appToolGroup, appAssistantPolicy })` beside #477's
 * tool group. Nothing outside this directory should reach for the ledger, the
 * link classifier, or the footer builder directly.
 */
export { createDocumentationAssistantPolicy } from './policy'
export type { DocumentationAssistantPolicyDependencies } from './policy'
