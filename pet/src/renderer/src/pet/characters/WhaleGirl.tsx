import type { ActionId } from '@shared/types'

export type WhaleView = 'front' | 'side' | 'back'

export interface WhalePose {
  mode: ActionId
  view: WhaleView
  /** 侧面像左右翻转（往哪边看/走）。 */
  flip?: boolean
}

interface Props {
  pose: WhalePose
  hungry: boolean
}

/**
 * 鲸鱼娘（大肥鱼）三视图：正面 / 侧面 / 背面 PNG + CSS 动效。
 * （逐帧精灵方案实测一卡一卡的，已回退到这套轻量方案。）
 */
const SOURCES: Record<WhaleView, string> = {
  front: './sprites/whale-front.png',
  side: './sprites/whale-side.png',
  back: './sprites/whale-back.png'
}

export function WhaleGirl({ pose }: Props) {
  const { mode, view, flip } = pose
  return (
    <div className={`whale-stage mode-${mode} view-${view} ${flip ? 'is-flipped' : ''}`}>
      <div className="whale-flip">
        <img key={view} className="whale-art" src={SOURCES[view] ?? SOURCES.front} alt="" draggable={false} />
      </div>
    </div>
  )
}
