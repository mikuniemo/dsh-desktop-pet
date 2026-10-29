import type { ActionId } from '@shared/types'

interface Props {
  mode: ActionId
  hungry: boolean
}

export function Cat({ mode, hungry }: Props) {
  const happy = mode === 'click' || mode === 'eat' || mode === 'wake'
  const sleepy = mode === 'sleep'
  const angry = mode === 'angry'
  const wide = mode === 'drag'
  const think = mode === 'think'
  const work = mode === 'work'
  const normal = !happy && !sleepy && !angry && !wide && !think && !work

  return (
    <svg className="char-svg cat-svg" viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <linearGradient id="catFur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFC078" />
          <stop offset="0.55" stopColor="#F6A54A" />
          <stop offset="1" stopColor="#E89034" />
        </linearGradient>
        <linearGradient id="catBelly" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF3DF" />
          <stop offset="1" stopColor="#FFE0B5" />
        </linearGradient>
        <radialGradient id="catBlush">
          <stop offset="0" stopColor="#FF8E8E" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF8E8E" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse className="ground-shadow" cx="150" cy="287" rx="74" ry="9" fill="#3A2416" opacity="0.18" />

      <g className="cat-tail">
        <path
          d="M212 250 C 258 246, 284 212, 264 174"
          fill="none"
          stroke="#D97F2D"
          strokeWidth="27"
          strokeLinecap="round"
        />
        <path
          d="M212 250 C 258 246, 284 212, 264 174"
          fill="none"
          stroke="#F2A049"
          strokeWidth="20"
          strokeLinecap="round"
        />
        <path
          d="M266 185 C 272 178, 272 168, 265 161"
          fill="none"
          stroke="#B96822"
          strokeWidth="8"
          strokeLinecap="round"
          opacity="0.8"
        />
      </g>

      <g className="cat-body">
        <ellipse cx="150" cy="240" rx="80" ry="57" fill="url(#catFur)" />
        <ellipse cx="150" cy="254" rx="50" ry="39" fill="url(#catBelly)" />
        <ellipse cx="91" cy="281" rx="29" ry="13" fill="#FFE3BB" />
        <ellipse cx="209" cy="281" rx="29" ry="13" fill="#FFE3BB" />
        <path d="M80 232 q10 -18 24 -9" fill="none" stroke="#D97F2D" strokeWidth="5" strokeLinecap="round" opacity="0.5" />
        <path d="M220 232 q-10 -18 -24 -9" fill="none" stroke="#D97F2D" strokeWidth="5" strokeLinecap="round" opacity="0.5" />
      </g>

      <g className="cat-head">
        <g className="cat-ear cat-ear-left">
          <path d="M80 92 L86 32 L132 72 Z" fill="#E89034" />
          <path d="M91 84 L95 48 L121 72 Z" fill="#FFB7B7" />
        </g>
        <g className="cat-ear cat-ear-right">
          <path d="M220 92 L214 32 L168 72 Z" fill="#E89034" />
          <path d="M209 84 L205 48 L179 72 Z" fill="#FFB7B7" />
        </g>

        <ellipse cx="150" cy="134" rx="79" ry="73" fill="url(#catFur)" />
        <ellipse className="cat-angry-tint" cx="150" cy="134" rx="79" ry="73" fill="#FF6F5E" opacity="0" />

        <g className="cat-stripes" fill="#D97F2D" opacity="0.85">
          <rect x="136" y="64" width="8" height="24" rx="4" />
          <rect x="150" y="60" width="8" height="28" rx="4" />
          <rect x="164" y="64" width="8" height="24" rx="4" />
        </g>

        {normal && (
          <g className="cat-eyes">
            <g className="eye eye-left">
              <ellipse cx="117" cy="133" rx="15" ry="18" fill="#4B342A" />
              <ellipse cx="117" cy="136" rx="9" ry="12" fill="#8A5A2E" />
              <ellipse cx="117" cy="137" rx="5" ry="9" fill="#2A1B14" />
              <circle cx="112" cy="126" r="4" fill="#FFFDF8" />
              <circle cx="121" cy="142" r="2" fill="#FFFDF8" opacity="0.7" />
            </g>
            <g className="eye eye-right">
              <ellipse cx="183" cy="133" rx="15" ry="18" fill="#4B342A" />
              <ellipse cx="183" cy="136" rx="9" ry="12" fill="#8A5A2E" />
              <ellipse cx="183" cy="137" rx="5" ry="9" fill="#2A1B14" />
              <circle cx="178" cy="126" r="4" fill="#FFFDF8" />
              <circle cx="187" cy="142" r="2" fill="#FFFDF8" opacity="0.7" />
            </g>
          </g>
        )}

        {happy && (
          <g className="cat-eyes-happy" fill="none" stroke="#4B342A" strokeWidth="6" strokeLinecap="round">
            <path d="M102 134 q15 -15 30 0" />
            <path d="M168 134 q15 -15 30 0" />
          </g>
        )}

        {sleepy && (
          <g className="cat-eyes-sleep" fill="none" stroke="#4B342A" strokeWidth="6" strokeLinecap="round">
            <path d="M103 134 q14 10 28 0" />
            <path d="M169 134 q14 10 28 0" />
          </g>
        )}

        {wide && (
          <g className="cat-eyes-wide">
            <ellipse cx="117" cy="131" rx="18" ry="22" fill="#FFFDF8" />
            <ellipse cx="183" cy="131" rx="18" ry="22" fill="#FFFDF8" />
            <ellipse cx="117" cy="134" rx="7" ry="10" fill="#2A1B14" />
            <ellipse cx="183" cy="134" rx="7" ry="10" fill="#2A1B14" />
            <circle cx="113" cy="128" r="3" fill="#FFFFFF" />
            <circle cx="179" cy="128" r="3" fill="#FFFFFF" />
          </g>
        )}

        {angry && (
          <g className="cat-angry-face">
            <path d="M98 112 L132 122" stroke="#4B342A" strokeWidth="6" strokeLinecap="round" />
            <path d="M202 112 L168 122" stroke="#4B342A" strokeWidth="6" strokeLinecap="round" />
            <ellipse cx="117" cy="137" rx="11" ry="9" fill="#4B342A" />
            <ellipse cx="183" cy="137" rx="11" ry="9" fill="#4B342A" />
            <circle cx="114" cy="134" r="2.5" fill="#FFFDF8" />
            <circle cx="180" cy="134" r="2.5" fill="#FFFDF8" />
          </g>
        )}

        {think && (
          <g className="cat-think-face">
            <ellipse cx="116" cy="129" rx="14" ry="16" fill="#4B342A" />
            <ellipse cx="184" cy="129" rx="14" ry="16" fill="#4B342A" />
            <circle cx="112" cy="122" r="4" fill="#FFFDF8" />
            <circle cx="180" cy="122" r="4" fill="#FFFDF8" />
            <path d="M138 60 q12 -9 24 0" fill="none" stroke="#D97F2D" strokeWidth="4" strokeLinecap="round" opacity="0.55" />
            <ellipse cx="150" cy="180" rx="6" ry="5" fill="#7A3F35" />
          </g>
        )}

        {work && (
          <g className="cat-work-face">
            <path d="M100 111 L131 120" stroke="#4B342A" strokeWidth="6" strokeLinecap="round" />
            <path d="M200 111 L169 120" stroke="#4B342A" strokeWidth="6" strokeLinecap="round" />
            <ellipse cx="117" cy="138" rx="10" ry="8" fill="#4B342A" />
            <ellipse cx="183" cy="138" rx="10" ry="8" fill="#4B342A" />
            <circle cx="114" cy="135" r="2.5" fill="#FFFDF8" />
            <circle cx="180" cy="135" r="2.5" fill="#FFFDF8" />
            <path d="M139 182 q11 -7 22 0" fill="none" stroke="#6B4632" strokeWidth="4" strokeLinecap="round" />
          </g>
        )}

        <ellipse cx="96" cy="166" rx="18" ry="11" fill="url(#catBlush)" />
        <ellipse cx="204" cy="166" rx="18" ry="11" fill="url(#catBlush)" />

        <ellipse cx="150" cy="169" rx="37" ry="25" fill="#FFF1DC" />
        <path d="M150 154 L160 162 L150 170 L140 162 Z" fill="#FF9B9B" />

        {normal && !hungry && (
          <path
            d="M150 171 q-8 9 -17 2 M150 171 q8 9 17 2"
            fill="none"
            stroke="#6B4632"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
        {normal && hungry && (
          <path
            d="M135 178 q15 -8 30 0"
            fill="none"
            stroke="#6B4632"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
        {happy && <ellipse cx="150" cy="180" rx="12" ry="10" fill="#7A3F35" />}
        {happy && <ellipse cx="150" cy="185" rx="6" ry="4" fill="#FF9B9B" />}
        {sleepy && <ellipse cx="150" cy="180" rx="6" ry="5" fill="#7A3F35" />}
        {wide && <ellipse cx="150" cy="181" rx="7" ry="9" fill="#7A3F35" />}
        {angry && (
          <path
            d="M137 184 q13 -10 26 0"
            fill="none"
            stroke="#6B4632"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}

        <g stroke="#6B4632" strokeWidth="2.5" strokeLinecap="round" opacity="0.55">
          <path d="M78 160 L40 152" />
          <path d="M78 170 L38 168" />
          <path d="M78 180 L42 184" />
          <path d="M222 160 L260 152" />
          <path d="M222 170 L262 168" />
          <path d="M222 180 L258 184" />
        </g>

        <g className="cat-steam" fill="#FFB9AE" opacity="0">
          <circle cx="232" cy="72" r="9" />
          <circle cx="247" cy="58" r="6" />
          <circle cx="68" cy="72" r="9" />
          <circle cx="53" cy="58" r="6" />
        </g>
      </g>

      <g className="cat-paws">
        <rect x="108" y="256" width="34" height="24" rx="16" fill="#FFE8C7" />
        <rect x="158" y="256" width="34" height="24" rx="16" fill="#FFE8C7" />
        <path d="M118 276 v-8 M125 276 v-8 M132 276 v-8" stroke="#E8B87C" strokeWidth="2" strokeLinecap="round" />
        <path d="M168 276 v-8 M175 276 v-8 M182 276 v-8" stroke="#E8B87C" strokeWidth="2" strokeLinecap="round" />
      </g>

      {mode === 'eat' && (
        <g className="cat-snack">
          <circle cx="222" cy="166" r="10" fill="#C98A4B" />
          <circle cx="218" cy="163" r="2.5" fill="#8A5527" />
          <circle cx="226" cy="169" r="2" fill="#8A5527" />
          <path d="M218 172 q4 3 8 0" stroke="#8A5527" strokeWidth="2" fill="none" />
        </g>
      )}
    </svg>
  )
}
