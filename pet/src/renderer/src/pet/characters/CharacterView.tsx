import type { CharacterId } from '@shared/types'
import { Cat } from './Cat'
import { Ghost } from './Ghost'
import { Slime } from './Slime'
import { WhaleGirl } from './WhaleGirl'
import type { WhalePose } from './WhaleGirl'

interface Props {
  character: CharacterId
  pose: WhalePose
  hungry?: boolean
}

export function CharacterView({ character, pose, hungry = false }: Props) {
  // 鲸鱼娘用三视图 PNG + CSS 动效（逐帧精灵方案实测卡顿，已弃用）；
  // 另外三只是纯 SVG 备用角色。
  if (character === 'cat') return <Cat mode={pose.mode} hungry={hungry} />
  if (character === 'ghost') return <Ghost mode={pose.mode} hungry={hungry} />
  if (character === 'slime') return <Slime mode={pose.mode} hungry={hungry} />
  return <WhaleGirl pose={pose} hungry={hungry} />
}
