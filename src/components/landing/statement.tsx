const STATEMENT =
  "Most small businesses run on group chats, spreadsheets and memory. EveryOps turns the way you already work into a system your whole team can use, and changes it whenever you ask.";

/**
 * A single sentence read at the reader's pace: words brighten in order as it scrolls through.
 * The full sentence is always in the DOM, so screen readers and no-motion visitors get it whole.
 */
export function Statement() {
  const words = STATEMENT.split(" ");
  return (
    <section className="mx-auto w-full max-w-[1120px] px-5 py-28 sm:py-40">
      <p className="scrub-words max-w-[980px] text-balance text-[30px] font-semibold leading-[1.18] tracking-[-0.025em] sm:text-[44px] lg:text-[52px]">
        {words.map((word, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed sentence, words never reorder
            key={i}
            className={word === "EveryOps" ? "scrub-word text-primary" : "scrub-word"}
            style={{ "--p": i / (words.length - 1) } as React.CSSProperties}
          >
            {word}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}
