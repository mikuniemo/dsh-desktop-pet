import type { ActionId } from '@shared/types'

interface Props {
  mode: ActionId
  hungry: boolean
}

export function Ghost({ mode, hungry }: Props) {
  const happy = mode === 'click' || mode === 'eat' || mode === 'wake'
  const sleepy = mode === 'sleep'
  const angry = mode === 'angry'
  const wide = mode === 'drag'
  const think = mode === 'think'
  const work = mode === 'work'
  const normal = !happy && !sleepy && !angry && !wide && !think && !work

  return (
    <svg className="char-svg ghost-svg" viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <linearGradient id="ghostBody" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#EDF8FF" />
          <stop offset="1" stopColor="#C8E6FF" />
        </linearGradient>
        <radialGradient id="ghostGlow">
          <stop offset="0" stopColor="#A8DFFF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#A8DFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ghostBlush">
          <stop offset="0" stopColor="#FF9FBF" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FF9FBF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse className="ground-shadow" cx="150" cy="286" rx="58" ry="8" fill="#274A70" opacity="0.15" />
      <ellipse cx="150" cy="180" rx="122" ry="120" fill="url(#ghostGlow)" className="ghost-glow" />

      <g className="ghost-body-group">
        <path
          d="M62 150 C62 78, 238 78, 238 150 L238 232
             C238 248, 226 256, 214 244
             C204 234, 190 234, 180 244
             C170 254, 156 254, 146 244
             C136 234, 122 234, 112 244
             C100 256, 88 248, 88 232
             C80 240, 62 236, 62 220 Z"
          fill="url(#ghostBody)"
          stroke="#B9DEF8"
          strokeWidth="2"
        />
        <path
          d="M78 214 C96 222, 104 210, 116 222 C128 234, 144 232, 152 220 C160 208, 178 208, 190 220 C202 232, 218 226, 228 214"
          fill="none"
          stroke="#BEE4FA"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.8"
        />
        <ellipse className="ghost-angry-tint" cx="150" cy="160" rx="88" ry="80" fill="#FF8D8D" opacity="0" />

        <g className="ghost-arm ghost-arm-left">
          <ellipse cx="60" cy="190" rx="15" ry="24" fill="#E4F5FF" transform="rotate(22 60 190)" />
        </g>
        <g className="ghost-arm ghost-arm-right">
          <ellipse cx="240" cy="190" rx="15" ry="24" fill="#E4F5FF" transform="rotate(-22 240 190)" />
        </g>

        <g className="ghost-tuft">
          <path
            d="M150 82 C142 64, 158 56, 154 40 C168 50, 176 66, 166 82"
            fill="#F3FBFF"
            stroke="#B9DEF8"
            strokeWidth="2"
          />
        </g>

        <g className="ghost-star" fill="#FFE08A">
          <path d="M218 92 l4 10 10 1 -8 7 2 10 -8 -6 -9 6 3 -10 -8 -7 10 -1 Z" />
        </g>

        {normal && (
          <g className="ghost-eyes">
            <ellipse cx="116" cy="148" rx="17" ry="21" fill="#30405E" />
            <ellipse cx="184" cy="148" rx="17" ry="21" fill="#30405E" />
            <circle cx="111" cy="140" r="5" fill="#FFFFFF" />
            <circle cx="179" cy="140" r="5" fill="#FFFFFF" />
            <circle cx="121" cy="156" r="2.5" fill="#FFFFFF" opacity="0.7" />
            <circle cx="189" cy="156" r="2.5" fill="#FFFFFF" opacity="0.7" />
          </g>
        )}

        {happy && (
          <g fill="none" stroke="#30405E" strokeWidth="6" strokeLinecap="round">
            <path d="M100 150 q16 -17 32 0" />
            <path d="M168 150 q16 -17 32 0" />
          </g>
        )}

        {sleepy && (
          <g fill="none" stroke="#30405E" strokeWidth="6" strokeLinecap="round">
            <path d="M101 150 q15 11 30 0" />
            <path d="M169 150 q15 11 30 0" />
          </g>
        )}

        {wide && (
          <g>
            <ellipse cx="116" cy="146" rx="21" ry="25" fill="#FFFFFF" />
            <ellipse cx="184" cy="146" rx="21" ry="25" fill="#FFFFFF" />
            <ellipse cx="116" cy="150" rx="8" ry="12" fill="#30405E" />
            <ellipse cx="184" cy="150" rx="8" ry="12" fill="#30405E" />
            <circle cx="112" cy="142" r="3.5" fill="#FFFFFF" />
            <circle cx="180" cy="142" r="3.5" fill="#FFFFFF" />
          </g>
        )}

        {angry && (
          <g>
            <path d="M98 128 L132 138" stroke="#30405E" strokeWidth="6" strokeLinecap="round" />
            <path d="M202 128 L168 138" stroke="#30405E" strokeWidth="6" strokeLinecap="round" />
            <ellipse cx="116" cy="152" rx="12" ry="10" fill="#30405E" />
            <ellipse cx="184" cy="152" rx="12" ry="10" fill="#30405E" />
            <circle cx="113" cy="149" r="2.5" fill="#FFFFFF" />
            <circle cx="181" cy="149" r="2.5" fill="#FFFFFF" />
          </g>
        )}

        {think && (
          <g className="ghost-think-face">
            <ellipse cx="116" cy="143" rx="16" ry="19" fill="#30405E" />
            <ellipse cx="184" cy="143" rx="16" ry="19" fill="#30405E" />
            <circle cx="111" cy="136" r="4.5" fill="#FFFFFF" />
            <circle cx="179" cy="136" r="4.5" fill="#FFFFFF" />
            <ellipse cx="150" cy="188" rx="6" ry="5" fill="#35445F" />
          </g>
        )}

        {work && (
          <g className="ghost-work-face">
            <path d="M98 130 L131 139" stroke="#30405E" strokeWidth="6" strokeLinecap="round" />
            <path d="M202 130 L169 139" stroke="#30405E" strokeWidth="6" strokeLinecap="round" />
            <ellipse cx="116" cy="153" rx="11" ry="9" fill="#30405E" />
            <ellipse cx="184" cy="153" rx="11" ry="9" fill="#30405E" />
            <circle cx="113" cy="150" r="2.5" fill="#FFFFFF" />
            <circle cx="181" cy="150" r="2.5" fill="#FFFFFF" />
            <path d="M138 192 q12 -8 24 0" fill="none" stroke="#38506F" strokeWidth="4" strokeLinecap="round" />
          </g>
        )}

        <ellipse cx="94" cy="178" rx="19" ry="11" fill="url(#ghostBlush)" />
        <ellipse cx="206" cy="178" rx="19" ry="11" fill="url(#ghostBlush)" />

        {normal && !hungry && (
          <path
            d="M150 178 q-9 12 -18 3 M150 178 q9 12 18 3"
            fill="none"
            stroke="#38506F"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
        {normal && hungry && (
          <path
            d="M134 188 q16 -10 32 0"
            fill="none"
            stroke="#38506F"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
        {happy && <ellipse cx="150" cy="189" rx="13" ry="11" fill="#35445F" />}
        {happy && <ellipse cx="150" cy="194" rx="6" ry="4" fill="#FF9FBF" />}
        {sleepy && <ellipse cx="150" cy="188" rx="6" ry="5" fill="#35445F" />}
        {wide && <ellipse cx="150" cy="190" rx="8" ry="10" fill="#35445F" />}
        {angry && (
          <path
            d="M136 194 q14 -11 28 0"
            fill="none"
            stroke="#38506F"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}

        <g className="ghost-steam" fill="#FFC2D4" opacity="0">
          <circle cx="228" cy="88" r="9" />
          <circle cx="243" cy="74" r="6" />
          <circle cx="72" cy="88" r="9" />
          <circle cx="57" cy="74" r="6" />
        </g>
      </g>

      {mode === 'eat' && (
        <g className="ghost-snack">
          <rect x="212" y="160" width="18" height="14" rx="4" fill="#FFD36E" transform="rotate(12 221 167)" />
          <circle cx="219" cy="166" r="2" fill="#B9852F" />
          <circle cx="226" cy="168" r="2" fill="#B9852F" />
        </g>
      )}
    </svg>
  )
}
