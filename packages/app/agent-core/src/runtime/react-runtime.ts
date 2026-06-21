import type { ChatEvent } from '@tinytinkerer/contracts'
import { createEvent } from '../events/create-event'
import type { ExecutionContext } from '../types'
import { AgentRuntimeBase, type RunOptions } from './agent-runtime-base'

// ReAct: reason and act iteratively. There is no upfront plan — the provider
// decides the next single action (a tool call) or to finish, given the
// observations gathered so far, repeating until it finishes or the iteration
// budget runs out. Then the answer is synthesized from the accumulated context.
export class ReActRuntime extends AgentRuntimeBase {
  async *run(prompt: string, options: RunOptions = {}): AsyncGenerator<ChatEvent> {
    const { signal } = options
    const context: ExecutionContext = this.createContext(prompt, options.history ?? [])

    yield createEvent('user.message', { text: prompt })
    yield createEvent('agent.run.started', { agentType: 'react' })

    try {
      const result = yield* this.runReActLoop(context, {
        budget: this.maxIterations,
        ...(signal ? { signal } : {})
      })

      yield createEvent('agent.run.completed', { steps: result.iterations })

      if (signal?.aborted) {
        yield createEvent('assistant.done', (await this.createAssistantContentSession()).snapshot())
        return
      }

      yield* this.synthesizeWithRateLimit(context, signal)
    } catch (error) {
      yield* this.handleRunError(error)
    }
  }
}
