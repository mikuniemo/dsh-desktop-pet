import type { ActionId } from '@shared/types'

interface Props {
  mode: ActionId
  hungry: boolean
}

export function Slime({ mode, hungry }: Props) {
  const happy = mode === 'click' || mode === 'eat' || mode === 'wake'
  const sleepy = mode === 'sleep'
  const angry = mode === 'angry'
  const wide = mode === 'drag'
  const think = mode === 'think'
  const work = mode === 'work'
  const normal = !happy && !sleepy && !angry && !wide && !think && !work

  return (
    <svg className="char-svg slime-svg" viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <linearGradient id="slimeBody" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#C6FBD5" />
          <stop offset="0.5" stopColor="#8BE9A8" />
          <stop offset="1" stopColor="#57C97F" />
        </linearGradient>
        <radialGradient id="slimeBlush">
          <stop offset="0" stopColor="#FF8FA8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF8FA8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="slimeGlow">
          <stop offset="0" stopColor="#B6FFD0" stopOpacity="0.5" />
          <stop offset="1" stopColor="#B6FFD0" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse className="ground-shadow" cx="150" cy="286" rx="82" ry="9" fill="#1D4A2C" opacity="0.18" />
      <ellipse cx="150" cy="200" rx="130" ry="110" fill="url(#slimeGlow)" className="slime-glow" />

      <g className="slime-body-group">
        <path
          className="slime-body-path"
          d="M150 78
             C 206 78, 252 132, 254 198
             C 256 248, 214 282, 150 282
             C 86 282, 44 248, 46 198
             C 48 132, 94 78, 150 78 Z"
          fill="url(#slimeBody)"
          stroke="#4AB273"
          strokeWidth="2"
        />
        <ellipse className="slime-angry-tint" cx="150" cy="190" rx="100" ry="85" fill="#FF7B6E" opacity="0" />

        <g className="slime-sprout">
          <path d="M150 80 C150 64, 150 54, 150 46" stroke="#3E9D61" strokeWidth="5" strokeLinecap="round" />
          <path
            d="M149 54 C136 56, 126 48, 126 36 C140 34, 150 42, 149 54 Z"
            fill="#6FD98D"
            stroke="#3E9D61"
            strokeWidth="2"
          />
          <path
            d="M152 48 C165 48, 174 39, 173 28 C160 28, 151 36, 152 48 Z"
            fill="#8CEAA4"
            stroke="#3E9D61"
            strokeWidth="2"
          />
        </g>

        <ellipse cx="104" cy="132" rx="34" ry="22" fill="#EBFFF1" opacity="0.65" transform="rotate(-24 104 132)" />
        <ellipse cx="96" cy="125" rx="12" ry="7" fill="#FFFFFF" opacity="0.85" transform="rotate(-24 96 125)" />

        <g className="slime-arm slime-arm-left">
          <ellipse cx="48" cy="205" rx="12" ry="20" fill="#7FE09C" transform="rotate(24 48 205)" />
        </g>
        <g className="slime-arm slime-arm-right">
          <ellipse cx="252" cy="205" rx="12" ry="20" fill="#7FE09C" transform="rotate(-24 252 205)" />
        </g>

        {normal && (
          <g className="slime-eyes">
            <ellipse cx="116" cy="170" rx="16" ry="21" fill="#274E38" />
            <ellipse cx="184" cy="170" rx="16" ry="21" fill="#274E38" />
            <circle cx="111" cy="162" r="5" fill="#FFFFFF" />
            <circle cx="179" cy="162" r="5" fill="#FFFFFF" />
            <circle cx="121" cy="179" r="2.5" fill="#FFFFFF" opacity="0.6" />
            <circle cx="189" cy="179" r="2.5" fill="#FFFFFF" opacity="0.6" />
          </g>
        )}

        {happy && (
          <g fill="none" stroke="#274E38" strokeWidth="6" strokeLinecap="round">
            <path d="M100 172 q16 -17 32 0" />
            <path d="M168 172 q16 -17 32 0" />
          </g>
        )}

        {sleepy && (
          <g fill="none" stroke="#274E38" strokeWidth="6" strokeLinecap="round">
            <path d="M101 172 q15 11 30 0" />
            <path d="M169 172 q15 11 30 0" />
          </g>
        )}

        {wide && (
          <g>
            <ellipse cx="116" cy="168" rx="20" ry="25" fill="#FFFFFF" />
            <ellipse cx="184" cy="168" rx="20" ry="25" fill="#FFFFFF" />
            <ellipse cx="116" cy="172" rx="8" ry="12" fill="#274E38" />
            <ellipse cx="184" cy="172" rx="8" ry="12" fill="#274E38" />
            <circle cx="112" cy="164" r="3.5" fill="#FFFFFF" />
            <circle cx="180" cy="164" r="3.5" fill="#FFFFFF" />
          </g>
        )}

        {angry && (
          <g>
            <path d="M98 150 L132 160" stroke="#274E38" strokeWidth="6" strokeLinecap="round" />
            <path d="M202 150 L168 160" stroke="#274E38" strokeWidth="6" strokeLinecap="round" />
            <ellipse cx="116" cy="174" rx="11" ry="9" fill="#274E38" />
            <ellipse cx="184" cy="174" rx="11" ry="9" fill="#274E38" />
            <circle cx="113" cy="171" r="2.5" fill="#FFFFFF" />
            <circle cx="181" cy="171" r="2.5" fill="#FFFFFF" />
          </g>
        )}

        {think && (
          <g className="slime-think-face">
            <ellipse cx="116" cy="165" rx="15" ry="20" fill="#274E38" />
            <ellipse cx="184" cy="165" rx="15" ry="20" fill="#274E38" />
            <circle cx="111" cy="157" r="4.5" fill="#FFFFFF" />
            <circle cx="179" cy="157" r="4.5" fill="#FFFFFF" />
            <ellipse cx="150" cy="210" rx="6" ry="5" fill="#2E6B49" />
          </g>
        )}

        {work && (
          <g className="slime-work-face">
            <path d="M98 152 L131 161" stroke="#274E38" strokeWidth="6" strokeLinecap="round" />
            <path d="M202 152 L169 161" stroke="#274E38" strokeWidth="6" strokeLinecap="round" />
            <ellipse cx="116" cy="175" rx="10" ry="8" fill="#274E38" />
            <ellipse cx="184" cy="175" rx="10" ry="8" fill="#274E38" />
            <circle cx="113" cy="172" r="2.5" fill="#FFFFFF" />
            <circle cx="181" cy="172" r="2.5" fill="#FFFFFF" />
            <path d="M138 214 q12 -8 24 0" fill="none" stroke="#2E6B49" strokeWidth="4" strokeLinecap="round" />
          </g>
        )}

        <ellipse cx="91" cy="201" rx="19" ry="11" fill="url(#slimeBlush)" />
        <ellipse cx="209" cy="201" rx="19" ry="11" fill="url(#slimeBlush)" />

        {normal && !hungry && (
          <path
            d="M150 200 q-9 12 -18 3 M150 200 q9 12 18 3"
            fill="none"
            stroke="#2E6B49"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
        {normal && hungry && (
          <path
            d="M134 210 q16 -10 32 0"
            fill="none"
            stroke="#2E6B49"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
        {happy && <ellipse cx="150" cy="211" rx="14" ry="12" fill="#2E6B49" />}
        {happy && <ellipse cx="150" cy="217" rx="7" ry="4" fill="#FF9FB1" />}
        {sleepy && <ellipse cx="150" cy="210" rx="6" ry="5" fill="#2E6B49" />}
        {wide && <ellipse cx="150" cy="212" rx="8" ry="10" fill="#2E6B49" />}
        {angry && (
          <path
            d="M136 216 q14 -11 28 0"
            fill="none"
            stroke="#2E6B49"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}

        <g className="slime-bubbles" fill="#FFFFFF" opacity="0.6">
          <circle cx="74" cy="236" r="5" />
          <circle cx="226" cy="248" r="7" />
          <circle cx="214" cy="228" r="3.5" />
        </g>

        <g className="slime-steam" fill="#FFC2B9" opacity="0">
          <circle cx="230" cy="94" r="9" />
          <circle cx="245" cy="80" r="6" />
          <circle cx="70" cy="94" r="9" />
          <circle cx="55" cy="80" r="6" />
        </g>
      </g>

      {mode === 'eat' && (
        <g className="slime-snack">
          <circle cx="222" cy="192" r="11" fill="#FF9B5C" />
          <path d="M222 181 q8 4 0 10 q-8 -6 0 -10" fill="#6FD98D" />
          <circle cx="218" cy="190" r="1.8" fill="#A8551F" />
          <circle cx="226" cy="194" r="1.8" fill="#A8551F" />
        </g>
      )}
    </svg>
  )
}
