/** Three dots while the assistant "thinks". Reduced motion shows them static. */
export function TypingIndicator({ label = "Hulma is thinking" }: { label?: string }) {
  return (
    <output aria-live="polite" className="inline-flex h-5 items-center gap-1">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="size-1.5 animate-typing rounded-full bg-muted-foreground"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </output>
  );
}
