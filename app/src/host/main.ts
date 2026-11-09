import './controlBar.css'
import { mountControlBar } from './controlBar'
import { skuSelect } from './controls/skuSelect'
import { sceneSelect } from './controls/sceneSelect'

/* Точка входа хоста. Плееру командует только через src/player/engine/playerContract.ts (setSku, setScene). */
mountControlBar(document.getElementById('control-bar')!, [
  skuSelect,
  sceneSelect,
  // сюда добавляем новые публичные действия плеера
])
