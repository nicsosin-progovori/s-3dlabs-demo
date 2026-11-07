import './controlBar.css'
import { mountControlBar } from './controlBar'
import { objectSelect } from './controls/objectSelect'

/* Точка входа хоста. Порядок в index.html важен: этот модуль идёт ДО плеера,
 * чтобы начальный объект (data-object) был выставлен до его монтирования. */
mountControlBar(document.getElementById('control-bar')!, [
  objectSelect,
  // сюда добавляем новые публичные действия плеера
])
