import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { z } from 'zod'
import { executeAudit, executeBind } from './binding'
import { excalidrawVerbContracts } from './contracts'
import type { CanvasController } from './controller-handle'
import { executeClear, executeDraw } from './create'
import { executeEdit } from './edit'
import { executeArrange, executePlace, executeSnap, executeSurvey } from './layout'
import { executePick } from './pick'
import { executeIcon, executePreset } from './presets'
import { executePreview } from './preview'
import { executeInspect, executeRead, executeSearch } from './query'
import {
  executeAlign,
  executeDelete,
  executeDistribute,
  executeDuplicate,
  executeGroup,
  executeOrder,
  executeStack,
  executeTransform
} from './structure'
import { executeThumbnail } from './thumbnail'

export type CanvasMethodRegistration = {
  inputSchema: z.ZodType
  resultSchema: z.ZodType
  handler(input: unknown): unknown
}

type TypedCanvasMethodRegistration<TInput extends z.ZodType, TResult extends z.ZodType> = {
  inputSchema: TInput
  resultSchema: TResult
  handler(input: z.output<TInput>): z.input<TResult> | Promise<z.input<TResult>>
}

const defineCanvasMethod = <TInput extends z.ZodType, TResult extends z.ZodType>(
  contract: { inputSchema: TInput; resultSchema: TResult },
  handler: TypedCanvasMethodRegistration<TInput, TResult>['handler']
): TypedCanvasMethodRegistration<TInput, TResult> => ({ ...contract, handler })

// Keep the in-process domain/controller binding schema-validated so invalid tool
// input and malformed results fail at the controller boundary.
export const createCanvasHandlers = (
  api: ExcalidrawImperativeAPI
): Record<string, CanvasMethodRegistration> => ({
  draw: defineCanvasMethod(excalidrawVerbContracts.draw, (input) => executeDraw(api, input)),
  search: defineCanvasMethod(excalidrawVerbContracts.search, (input) => executeSearch(api, input)),
  inspect: defineCanvasMethod(excalidrawVerbContracts.inspect, (input) =>
    executeInspect(api, input)
  ),
  read: defineCanvasMethod(excalidrawVerbContracts.read, (input) => executeRead(api, input)),
  edit: defineCanvasMethod(excalidrawVerbContracts.edit, (input) => executeEdit(api, input)),
  clear: defineCanvasMethod(excalidrawVerbContracts.clear, (input) => executeClear(api, input)),
  group: defineCanvasMethod(excalidrawVerbContracts.group, (input) => executeGroup(api, input)),
  duplicate: defineCanvasMethod(excalidrawVerbContracts.duplicate, (input) =>
    executeDuplicate(api, input)
  ),
  delete: defineCanvasMethod(excalidrawVerbContracts.delete, (input) => executeDelete(api, input)),
  align: defineCanvasMethod(excalidrawVerbContracts.align, (input) => executeAlign(api, input)),
  distribute: defineCanvasMethod(excalidrawVerbContracts.distribute, (input) =>
    executeDistribute(api, input)
  ),
  stack: defineCanvasMethod(excalidrawVerbContracts.stack, (input) => executeStack(api, input)),
  order: defineCanvasMethod(excalidrawVerbContracts.order, (input) => executeOrder(api, input)),
  transform: defineCanvasMethod(excalidrawVerbContracts.transform, (input) =>
    executeTransform(api, input)
  ),
  bind: defineCanvasMethod(excalidrawVerbContracts.bind, (input) => executeBind(api, input)),
  audit: defineCanvasMethod(excalidrawVerbContracts.audit, (input) => executeAudit(api, input)),
  snap: defineCanvasMethod(excalidrawVerbContracts.snap, (input) => executeSnap(api, input)),
  place: defineCanvasMethod(excalidrawVerbContracts.place, (input) => executePlace(api, input)),
  arrange: defineCanvasMethod(excalidrawVerbContracts.arrange, (input) =>
    executeArrange(api, input)
  ),
  survey: defineCanvasMethod(excalidrawVerbContracts.survey, (input) => executeSurvey(api, input)),
  preset: defineCanvasMethod(excalidrawVerbContracts.preset, (input) => executePreset(api, input)),
  icon: defineCanvasMethod(excalidrawVerbContracts.icon, (input) => executeIcon(api, input)),
  preview: defineCanvasMethod(excalidrawVerbContracts.preview, (input) =>
    executePreview(api, input)
  ),
  thumbnail: defineCanvasMethod(excalidrawVerbContracts.thumbnail, (input) =>
    executeThumbnail(api, input)
  ),
  pick: defineCanvasMethod(excalidrawVerbContracts.pick, (input) => executePick(api, input))
})

export const createCanvasController = (api: ExcalidrawImperativeAPI) => {
  const registrations = createCanvasHandlers(api)
  return Object.fromEntries(
    Object.entries(registrations).map(([method, registration]) => [
      method,
      (input: unknown) => {
        const parsed = registration.inputSchema.parse(input)
        return Promise.resolve(registration.handler(parsed)).then((result) =>
          registration.resultSchema.parse(result)
        )
      }
    ])
  ) as CanvasController
}
