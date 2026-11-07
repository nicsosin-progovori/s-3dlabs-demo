import './controlBar.css'
import { mountControlBar } from './controlBar'
import { skuSelect } from './controls/skuSelect'

/* Точка входа хоста. Плееру командует только через src/playerContract.ts (setSku). */
mountControlBar(document.getElementById('control-bar')!, [
  skuSelect,
  // сюда добавляем новые публичные действия плеера
])
