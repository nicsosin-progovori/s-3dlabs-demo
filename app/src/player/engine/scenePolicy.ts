import type { SceneDeclaration } from '../scenes/sceneContract.ts'

/* ПРАВИЛА ВЫБОРА СЦЕНЫ (#4, решения владельца). Чистые функции — проверяются node-тестами
 * (scripts/scene-switch.test.mjs); ObjectViewer только вызывает их.
 *   • главный — объект: при загрузке объекта ставится ЕГО сцена, прежний выбор хоста не учитывается;
 *   • сцены объекта — массив по приоритету; пока берётся первая (подбор для 1+ объектов — позже);
 *   • хост может сменить сцену только у ПОКАЗАННОГО объекта; та же сцена — ничего не делаем;
 *   • смена скина (тот же объект) сцену не меняет. */

/** Сцена при загрузке объекта. */
export function sceneOnLoad(objectScenes: SceneDeclaration): string {
  if (!objectScenes.length) throw new Error('Object has no scenes')
  return objectScenes[0]
}

/** Применять ли команду хоста «смени сцену». current — сцена показанного объекта, null — объекта нет. */
export function sceneCommandApplies(current: string | null, requested: string): boolean {
  return current !== null && current !== requested
}
