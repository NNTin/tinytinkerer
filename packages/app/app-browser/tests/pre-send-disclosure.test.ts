import { describe, expect, it, vi } from 'vitest'
import type { BrowserApp } from '../src/app.js'
import {
  createPreSendDisclosureStore,
  PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY,
  preSendDisclosureStoreFor,
  type PreSendDisclosure
} from '../src/pre-send-disclosure.js'

const DISCLOSURE: PreSendDisclosure = {
  version: '1',
  title: 'Before you send this',
  paragraphs: ['Your message goes to a model.']
}

/**
 * The slice of a `BrowserApp` the gate reads: its preferences, its configured
 * disclosure, and the acknowledgement `initializeBrowserApp` already resolved.
 *
 * A stub rather than a real app because a real one needs IndexedDB — and because
 * the eager/lazy split this gate is built around means the store's whole contract
 * with the app IS these three fields.
 */
const appStub = (
  options: { disclosure?: PreSendDisclosure; acknowledged?: string | null } = {}
) => {
  const values = new Map<string, string>()
  const set = vi.fn((key: string, value: string) => {
    values.set(key, value)
    return Promise.resolve()
  })
  const app = {
    shell: { preferences: { get: vi.fn(), set } },
    ...(options.disclosure ? { preSendDisclosure: options.disclosure } : {}),
    preSendDisclosureAcknowledged: options.acknowledged ?? null
  } as unknown as BrowserApp
  return { app, values, set }
}

describe('the pre-send disclosure gate (issue #481)', () => {
  it('gates nothing for an app that declared no disclosure', () => {
    const { app } = appStub()
    const gate = createPreSendDisclosureStore(app)

    expect(gate.getState().isRequired()).toBe(false)
  })

  it('requires acknowledgement the first time, and never again at the same version', async () => {
    const { app, values } = appStub({ disclosure: DISCLOSURE })
    const gate = createPreSendDisclosureStore(app)

    expect(gate.getState().isRequired()).toBe(true)

    const { requestId, decided } = gate.getState().request('How can I host TinyTinkerer?')
    expect(gate.getState().pending).toEqual({
      requestId,
      prompt: 'How can I host TinyTinkerer?'
    })

    await gate.getState().accept()

    expect(gate.getState().isRequired()).toBe(false)
    expect(gate.getState().pending).toBeNull()
    // The attempt gets its OWN answer, so a caller waits on what it asked rather
    // than on "something was approved recently".
    await expect(decided).resolves.toBe(true)
    expect(values.get(PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY)).toBe('1')

    // Written back to the app as well, so a store rebuilt later in the same
    // session — before the next bootstrap re-reads preferences — does not
    // re-prompt.
    expect(app.preSendDisclosureAcknowledged).toBe('1')
    expect(createPreSendDisclosureStore(app).getState().isRequired()).toBe(false)
  })

  it('never prompts a reader whose acknowledgement bootstrap already resolved', () => {
    const { app } = appStub({ disclosure: DISCLOSURE, acknowledged: '1' })

    // The reason the acknowledgement is read eagerly while the store is built
    // lazily: a store that had to hydrate itself would answer "I don't know yet"
    // on its first render, and for a privacy gate that must mean "ask again".
    expect(createPreSendDisclosureStore(app).getState().isRequired()).toBe(false)
  })

  it('asks again when the disclosed data flow changes version', () => {
    const { app } = appStub({ disclosure: { ...DISCLOSURE, version: '2' }, acknowledged: '1' })

    expect(createPreSendDisclosureStore(app).getState().isRequired()).toBe(true)
  })

  it('gates when bootstrap could not resolve an acknowledgement', () => {
    // `initializeBrowserApp` leaves this `null` when the preference read fails,
    // which must prompt rather than send.
    const { app } = appStub({ disclosure: DISCLOSURE, acknowledged: null })

    expect(createPreSendDisclosureStore(app).getState().isRequired()).toBe(true)
  })

  it('lets the acknowledged send through even when the acknowledgement cannot be written', async () => {
    const { app } = appStub({ disclosure: DISCLOSURE })
    vi.spyOn(app.shell.preferences, 'set').mockRejectedValue(new Error('quota exceeded'))
    const gate = createPreSendDisclosureStore(app)
    const { decided } = gate.getState().request('a question')

    await gate.getState().accept()

    // The reader is asked again next session — but refusing the send they just
    // approved would punish them for a storage failure they cannot act on.
    await expect(decided).resolves.toBe(true)
    expect(gate.getState().isRequired()).toBe(false)
  })

  it('dismissing settles nothing, and denies what was waiting', async () => {
    const { app, values } = appStub({ disclosure: DISCLOSURE })
    const gate = createPreSendDisclosureStore(app)
    const { decided } = gate.getState().request('a question')

    gate.getState().dismiss()

    await expect(decided).resolves.toBe(false)
    expect(gate.getState().pending).toBeNull()
    expect(gate.getState().isRequired()).toBe(true)
    expect(values.has(PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY)).toBe(false)
  })

  it('mints a distinct id per question', () => {
    const { app } = appStub({ disclosure: DISCLOSURE })
    const gate = createPreSendDisclosureStore(app)

    const first = gate.getState().request('one')
    gate.getState().dismiss()
    const second = gate.getState().request('two')

    expect(second.requestId).not.toBe(first.requestId)
  })

  it('joins a second send to the open question rather than replacing it', async () => {
    // Two sends racing one dialog: the reader answers once, and BOTH decisions
    // settle. Replacing `pending` would have shown one question and stranded the
    // first caller's promise forever.
    const { app } = appStub({ disclosure: DISCLOSURE })
    const gate = createPreSendDisclosureStore(app)

    const first = gate.getState().request('one')
    const second = gate.getState().request('two')

    expect(second.requestId).toBe(first.requestId)
    expect(gate.getState().pending?.prompt).toBe('one')

    await gate.getState().accept()

    await expect(first.decided).resolves.toBe(true)
    await expect(second.decided).resolves.toBe(true)
  })

  it('gives one app one gate, and two apps two', () => {
    // A document can host several BrowserApps (the docs assistant beside its
    // live labs). One shared gate would let a lab's surface answer, or be
    // blocked by, the assistant's disclosure.
    const { app: first } = appStub({ disclosure: DISCLOSURE })
    const { app: second } = appStub({ disclosure: DISCLOSURE })

    expect(preSendDisclosureStoreFor(first)).toBe(preSendDisclosureStoreFor(first))
    expect(preSendDisclosureStoreFor(second)).not.toBe(preSendDisclosureStoreFor(first))

    preSendDisclosureStoreFor(first).getState().request('a question')
    expect(preSendDisclosureStoreFor(second).getState().pending).toBeNull()
  })
})
