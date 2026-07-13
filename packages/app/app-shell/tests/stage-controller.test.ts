import { describe, expect, it } from 'vitest'
import { createStageControllerHandle } from '../src/stage-controller'

type Controller = {
  sync(input: unknown): unknown
  async(input: unknown): Promise<unknown>
  fail(): never
  reject(): Promise<never>
  value: string
}

describe('createStageControllerHandle', () => {
  it('rejects while loading and after the controller is cleared', async () => {
    const handle = createStageControllerHandle<Controller>('Workspace is still loading')
    await expect(handle.request('sync')).rejects.toThrow('Workspace is still loading')
    handle.setController({
      value: 'ready',
      sync() {
        return this.value
      },
      async: (input) => Promise.resolve(input),
      fail: () => {
        throw new Error('failed')
      },
      reject: () => Promise.reject(new Error('rejected'))
    })
    handle.setController(null)
    await expect(handle.request('sync')).rejects.toThrow('Workspace is still loading')
  })

  it('routes sync and async methods with the controller as this', async () => {
    const handle = createStageControllerHandle<Controller>('loading')
    handle.setController({
      value: 'mounted',
      sync(input) {
        return `${this.value}:${String(input)}`
      },
      async: (input) => Promise.resolve({ input }),
      fail: () => {
        throw new Error('failed')
      },
      reject: () => Promise.reject(new Error('rejected'))
    })

    await expect(handle.request('sync', 'value')).resolves.toBe('mounted:value')
    await expect(handle.request('async', 3)).resolves.toEqual({ input: 3 })
  })

  it('normalizes sync throws and async rejections', async () => {
    const handle = createStageControllerHandle<Controller>('loading')
    handle.setController({
      value: 'mounted',
      sync: (input) => input,
      async: (input) => Promise.resolve(input),
      fail: () => {
        // Deliberately exercise normalization of a third-party non-Error throw.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'sync failure'
      },
      // Deliberately exercise normalization of a third-party non-Error rejection.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject: () => Promise.reject('async failure')
    })

    await expect(handle.request('fail')).rejects.toEqual(new Error('sync failure'))
    await expect(handle.request('reject')).rejects.toEqual(new Error('async failure'))
  })
})
