import * as THREE from 'three'
import type { Material } from 'three'
import { attachProcessor, type MaterialProcessor, type ProcessorHandle } from './materialPipeline.ts'
import { importCode } from '../packages/packageCode.ts'
import type { SkinEnhancementRef } from '../../../contracts/skinEnhancement.ts'

/* ─────────────────────────────────────────────────────────────────────────────
 * УЛУЧШЕНИЕ СКИНА — необязательная программная часть скина.
 *
 * Базовый скин есть ВСЕГДА: материалы по слотам в стандарте glTF (skin.json).
 * Улучшение — код из пакета скина, который работает ПОВЕРХ базового скина:
 * генерирует узор, подкрашивает, правит шейдер, меняет блеск от угла камеры…
 * В плеер оно заходит единственным путём — процессорами пула материалов
 * (materialPipeline.ts), стадия 'skin'. Скина «только из кода» не бывает.
 *
 * Что улучшению можно: параметры и шейдер материалов СВОИХ слотов.
 * Что нельзя: геометрия, сцена, свет, камера, другие объекты, собственный import three
 * (модуль получает three движка в prepare — версия одна на всё приложение).
 *
 * Стандарт: docs/architecture/02-skin.md § «Улучшение скина».
 * ──────────────────────────────────────────────────────────────────────────── */

/** Версия API улучшений. Модуль с другой версией отклоняется. Изменение = публичный контракт, ревью. */
export const SKIN_ENHANCEMENT_API_VERSION = 1

/** Как улучшение описано в skin.json — контракт данных: app/contracts/skin-enhancement.schema.json. */
export type { SkinEnhancementRef }

/** Что модуль экспортирует по умолчанию (export default). */
export interface SkinEnhancementModule {
  apiVersion: typeof SKIN_ENHANCEMENT_API_VERSION
  /** Асинхронная подготовка до показа: сгенерировать текстуры, собрать данные. Сцену не трогает. */
  prepare(input: SkinEnhancementInput): Promise<PreparedSkinEnhancement>
}

export interface SkinEnhancementInput {
  skin: { id: string; revision: string }
  params: unknown
  quality: 'low' | 'final'
  /** единый экземпляр three движка */
  three: typeof THREE
  signal: AbortSignal
}

export interface PreparedSkinEnhancement {
  /** Подключиться к живым материалам слотов. Синхронно: вызывается при сборке и смене скина. */
  attach(target: SkinEnhancementTarget): AttachedSkinEnhancement | void
  /** Освободить то, что создано в prepare (текстуры и т.п.). */
  dispose?(): void
}

export interface SkinEnhancementTarget {
  /** слот → живые материалы слота (их может быть несколько: меши с разными атрибутами) */
  slots: ReadonlyMap<string, readonly Material[]>
  /** Подключить процессор ко всем материалам слота. Стадия — всегда 'skin';
   *  id становится 'skin.<id>'. Движок снимет его сам при смене/освобождении скина. */
  use(slot: string, processor: SkinProcessor): void
}

/** Процессор улучшения: всё как у процессора пула, кроме стадии — её задаёт движок. */
export type SkinProcessor = Omit<MaterialProcessor, 'stage'>

export interface AttachedSkinEnhancement {
  /** Откатить то, что сделано в attach помимо use(). Прямые правки параметров материала
   *  откатывать не обязательно: при смене скина движок заново копирует базовый скин. */
  dispose?(): void
}

const SHA = /^[a-f0-9]{64}$/
const FILE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+\.m?js$/
const MAX_BYTES = 512 * 1024

/** Проверка описания в skin.json. Строго: ошибка — ошибка всего скина. */
export function validateEnhancementRef(value: unknown): asserts value is SkinEnhancementRef {
  const v = value as Partial<SkinEnhancementRef> | null
  if (!v || typeof v !== 'object' || typeof v.file !== 'string' || !FILE.test(v.file) ||
      typeof v.sha256 !== 'string' || !SHA.test(v.sha256) ||
      typeof v.bytes !== 'number' || v.bytes <= 0 || v.bytes > MAX_BYTES)
    throw new Error('Invalid skin enhancement descriptor')
}

/** Загрузить модуль из уже проверенных по sha байтов. */
export async function importEnhancement(code: ArrayBuffer): Promise<SkinEnhancementModule> {
  const module = await importCode<Partial<SkinEnhancementModule>>(code)
  if (!module || typeof module.prepare !== 'function') throw new Error('Skin enhancement has no default export with prepare()')
  if (module.apiVersion !== SKIN_ENHANCEMENT_API_VERSION) throw new Error(`Skin enhancement API ${String(module.apiVersion)} is not supported (engine: ${SKIN_ENHANCEMENT_API_VERSION})`)
  return module as SkinEnhancementModule
}

/** Подключить подготовленное улучшение к живым материалам. Возвращает отключение. */
export function attachEnhancement(prepared: PreparedSkinEnhancement, slots: ReadonlyMap<string, readonly Material[]>): { dispose(): void } {
  const handles: ProcessorHandle[] = []
  const detachAll = () => { while (handles.length) handles.pop()!.detach() }
  let attached: AttachedSkinEnhancement | void
  try {
    attached = prepared.attach({
      slots,
      use(slot, processor) {
        const materials = slots.get(slot)
        if (!materials) throw new Error(`Skin enhancement uses unknown slot "${slot}"`)
        for (const material of materials) handles.push(attachProcessor(material, { ...processor, id: 'skin.' + processor.id, stage: 'skin' }))
      },
    })
  } catch (error) {
    detachAll()
    throw error
  }
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      try { attached?.dispose?.() } finally { detachAll() }
    },
  }
}

/** Загрузить и подготовить улучшение скина из проверенных по sha байтов кода. */
export async function prepareEnhancement(ref: SkinEnhancementRef, skin: { id: string; revision: string }, quality: 'low' | 'final', code: ArrayBuffer, signal: AbortSignal): Promise<PreparedSkinEnhancement> {
  const module = await importEnhancement(code)
  signal.throwIfAborted()
  const prepared = await module.prepare({ skin: { ...skin }, params: ref.params, quality, three: THREE, signal })
  if (!prepared || typeof prepared.attach !== 'function') throw new Error('Skin enhancement prepare() must return { attach }')
  if (signal.aborted) { prepared.dispose?.(); signal.throwIfAborted() }
  return prepared
}
