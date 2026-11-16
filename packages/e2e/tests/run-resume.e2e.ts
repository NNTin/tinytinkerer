import { expect, test, type Page, type Route } from '@playwright/test'
import { installChatMock } from '../fixtures/mock-litellm'
import { dismissFirstLoad, closeSettingsIfOpen } from '../fixtures/first-load'

// Issue #531, browser acceptance: a run's completed tool work survives a
// terminal decision failure and a REAL page reload (the app's own IndexedDB),
// and the reader's explicit Resume continues it from the unfinished decision
// against the SAME opaque project, with no completed mutation repeated.
//
// Domain-neutral and scripted. A stateful design service answers the browser's
// /api/mcp/call (the real edge requires a GitHub identity for MCP, and e2e runs
// are anonymous). The model is scripted at /api/models/chat: it derives each
// step from the tool messages it is actually sent, so a Resume that lost an
// observation would visibly repeat work. Every other /api route still goes
// through the real in-process edge (installChatMock). The decision timeout
// itself is covered under fake time in app-browser's
// run-checkpoint-resume.test.ts; here the next decision fails with a stream
// that ends without a decision, the same terminal path.

const SERVER = {
  id: 'designs',
  name: 'Designs',
  url: 'https://designs.e2e.test/mcp',
  enabled: true
}
const TOOLS = ['create_project', 'add_parts', 'add_links', 'build_guide'] as const
const PROMPT = 'Make the design and its guide.'
const ANSWER = 'All four steps are done for the saved design.'

type Message = { role: string; content: string | null }

const sse = (chunks: unknown[]): string =>
  chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'

const fulfillSse = (route: Route, body: string) =>
  route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body })

const projectIdIn = (messages: Message[]): string | undefined => {
  for (const message of messages) {
    if (message.role !== 'tool' || !message.content || message.content.startsWith('Error')) continue
    const envelope = JSON.parse(message.content) as {
      toolName?: string
      raw?: { content?: { text?: string }[] }
    }
    if (envelope.toolName === 'create_project') {
      return (JSON.parse(envelope.raw?.content?.[0]?.text ?? '{}') as { projectId?: string })
        .projectId
    }
  }
}

const installDesignService = async (page: Page) => {
  const projects = new Map<string, string[]>()
  const calls: { tool: string; projectId?: unknown }[] = []
  const decisions: Message[][] = []
  let failNext = false

  await page.route('**/api/mcp/call', async (route) => {
    const request = route.request().postDataJSON() as {
      toolName: string
      arguments?: Record<string, unknown>
    }
    const args = request.arguments ?? {}
    calls.push({ tool: request.toolName, projectId: args.projectId })
    let result: unknown
    if (request.toolName === 'create_project') {
      const projectId = crypto.randomUUID()
      projects.set(projectId, [])
      result = { projectId }
    } else {
      const project = projects.get(String(args.projectId))
      project?.push(request.toolName)
      result =
        request.toolName === 'build_guide'
          ? { projectId: args.projectId, steps: project ?? [] }
          : { accepted: Boolean(project) }
    }
    const text = JSON.stringify(result)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        serverName: SERVER.name,
        toolName: request.toolName,
        text,
        raw: { content: [{ type: 'text', text }] },
        isError: false
      })
    })
  })

  await page.route('**/api/models/chat', async (route) => {
    const request = route.request().postDataJSON() as {
      tool_choice?: string
      messages: Message[]
      tools?: { function: { name: string } }[]
    }
    if (request.tool_choice !== 'auto') {
      return fulfillSse(route, sse([{ choices: [{ delta: { content: ANSWER } }] }]))
    }
    decisions.push(request.messages)
    const done = request.messages.filter((message) => message.role === 'tool').length
    if (done === TOOLS.length && failNext) {
      failNext = false
      // Ends without a decision: the terminal decision-failure path.
      return fulfillSse(route, '')
    }
    const step = TOOLS[done]
    if (!step) {
      return fulfillSse(
        route,
        sse([
          { choices: [{ delta: { content: 'Ready.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ])
      )
    }
    const wire = request.tools
      ?.map((tool) => tool.function.name)
      .find((name) => name.endsWith(step))
    const args =
      step === 'create_project' ? { name: 'demo' } : { projectId: projectIdIn(request.messages) }
    return fulfillSse(
      route,
      sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `c${done}`,
                    function: { name: wire, arguments: JSON.stringify(args) }
                  }
                ]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
      ])
    )
  })

  return {
    projects,
    calls,
    decisions,
    failNextDecision: () => {
      failNext = true
    }
  }
}

// The user's MCP server and its discovery, written where Settings persists them
// (the app's own preferences store), so the runtime registers the tools.
const seedMcpServer = (page: Page) =>
  page.evaluate(
    ([server, tools]) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('tinytinkerer')
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('preferences', 'readwrite')
          const store = tx.objectStore('preferences')
          store.put({ key: 'settings_mcp_servers', value: JSON.stringify([server]) })
          store.put({
            key: 'settings_mcp_discovery',
            value: JSON.stringify({
              [server.id]: {
                serverId: server.id,
                serverName: server.name,
                syncedAt: new Date().toISOString(),
                tools: tools.map((toolName) => ({
                  toolName,
                  description: `Design service ${toolName}`,
                  inputSchema: { type: 'object', properties: {}, additionalProperties: true }
                }))
              }
            })
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('seed failed'))
        }
        request.onerror = () => reject(request.error ?? new Error('open failed'))
      }),
    [SERVER, [...TOOLS]] as const
  )

test('Resume continues saved tool work after a real reload without repeating it (#531)', async ({
  page
}) => {
  await installChatMock(page)
  const service = await installDesignService(page)
  await page.goto('/web/')
  await dismissFirstLoad(page)
  await seedMcpServer(page)
  await page.reload()
  await closeSettingsIfOpen(page)

  service.failNextDecision()
  const composer = page.locator('textarea').first()
  await composer.fill(PROMPT)
  await composer.press('Enter')

  // Truthful partial completion, and the saved progress is offered for Resume.
  await expect(page.getByText('This run stopped before it finished.')).toBeVisible({
    timeout: 30_000
  })
  expect(service.calls.map((call) => call.tool)).toEqual([...TOOLS])
  const [projectId] = [...service.projects.keys()]
  await expect(page.getByText(projectId!)).toHaveCount(0)

  // A real reload: everything comes back from the app's own IndexedDB.
  await page.reload()
  await closeSettingsIfOpen(page)
  await expect(page.getByText('This run stopped before it finished.')).toBeVisible({
    timeout: 30_000
  })
  await expect(page.getByText(/Saved progress: 4 completed tool calls/)).toBeVisible()
  const decisionsBefore = service.decisions.length
  expect(decisionsBefore).toBe(5)

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })

  // One project, no completed call repeated, and the resumed decision saw
  // every saved observation of that SAME project.
  expect(service.projects.size).toBe(1)
  expect(service.calls.map((call) => call.tool)).toEqual([...TOOLS])
  expect(service.calls.slice(1).every((call) => call.projectId === projectId)).toBe(true)
  const resumed = service.decisions[decisionsBefore]!
  expect(resumed.filter((message) => message.role === 'tool')).toHaveLength(4)
  expect(projectIdIn(resumed)).toBe(projectId)

  // One turn, nothing left to resume, and it stays that way after a reload.
  await expect(page.locator('[class*="user-bubble"]', { hasText: PROMPT })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0)
  await page.reload()
  await closeSettingsIfOpen(page)
  await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0)
})
