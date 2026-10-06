export function SamplePage({ annotated = true }: { annotated?: boolean }) {
  return (
    <svg
      className="sample-worksheet"
      viewBox="0 0 640 760"
      role="img"
      aria-label="Sample algebra assignment with a worked first step and a tutor annotation"
    >
      <rect width="640" height="760" fill="light-dark(#fffefa, #2c291f)" />
      <path
        d="M66 0V760"
        stroke="light-dark(#eccbc4, #855247)"
        strokeWidth="1"
      />
      {Array.from({ length: 17 }, (_, i) => (
        <line
          key={i}
          x1="67"
          x2="617"
          y1={225 + i * 29}
          y2={225 + i * 29}
          stroke="light-dark(#e9edf2, #566476)"
        />
      ))}
      <text
        x="98"
        y="63"
        fill="light-dark(#87918f, #b4bbc5)"
        fontSize="11"
        letterSpacing="2.5"
        fontFamily="sans-serif"
      >
        THE ALGEBRA NOTEBOOK
      </text>
      <text
        x="98"
        y="109"
        fill="light-dark(#263044, #cfd4de)"
        fontSize="30"
        fontFamily="Georgia,serif"
      >
        A little balance goes a long way.
      </text>
      <text
        x="98"
        y="140"
        fill="light-dark(#7b8190, #b4bbc5)"
        fontSize="13"
        fontFamily="sans-serif"
      >
        Practice 03 · Linear equations
      </text>
      <path d="M98 166H583" stroke="light-dark(#dedfdc, #41464e)" />
      <text
        x="98"
        y="203"
        fill="light-dark(#465066, #b4bbc5)"
        fontSize="14"
        fontFamily="sans-serif"
      >
        1. Solve for x. Show your thinking.
      </text>
      <text
        x="135"
        y="271"
        fill="light-dark(#263044, #cfd4de)"
        fontSize="34"
        fontFamily="Georgia,serif"
      >
        3x + 6 = 18
      </text>
      <text
        x="153"
        y="339"
        fill="light-dark(#4361ee, #95a2df)"
        fontSize="28"
        fontStyle="italic"
        fontFamily="Georgia,serif"
      >
        3x + 6 − 6 = 18 − 6
      </text>
      <text
        x="187"
        y="395"
        fill="light-dark(#4361ee, #95a2df)"
        fontSize="29"
        fontStyle="italic"
        fontFamily="Georgia,serif"
      >
        3x = 12
      </text>
      <text
        x="98"
        y="518"
        fill="light-dark(#465066, #b4bbc5)"
        fontSize="14"
        fontFamily="sans-serif"
      >
        2. Your turn. What would you do first?
      </text>
      <text
        x="135"
        y="581"
        fill="light-dark(#263044, #cfd4de)"
        fontSize="34"
        fontFamily="Georgia,serif"
      >
        2x + 5 = 13
      </text>
      <text
        x="98"
        y="713"
        fill="light-dark(#969ba4, #b4bbc5)"
        fontSize="11"
        fontFamily="sans-serif"
      >
        SAMPLE ASSIGNMENT · 1 OF 2
      </text>
      {annotated && (
        <g
          className="sample-tutor-ink"
          fill="none"
          stroke="light-dark(#bc704e, #ceb2a6)"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <ellipse
            className="draw-circle"
            cx="251"
            cy="263"
            rx="31"
            ry="27"
            transform="rotate(-8 251 263)"
          />
          <path
            className="draw-arrow"
            d="M282 264Q375 240 415 294m-2-14 2 14-14-3"
          />
          <text
            x="412"
            y="320"
            stroke="none"
            fill="light-dark(#b16d4f, #cbb3a9)"
            fontSize="19"
            fontStyle="italic"
            fontFamily="Georgia,serif"
          >
            keep it balanced
          </text>
          <path d="M172 410q89 6 153-2" />
        </g>
      )}
    </svg>
  );
}
