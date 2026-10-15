/** Resolve generated view references through the current workspace, never a model-invented URL. */
export function viewMarkdown(text: string, hrefFor: (id: string) => string | undefined): string {
  return text.replace(/\[([^\]\n]+)\]\(view:([a-zA-Z0-9_-]+)\)/g, (_match, label: string, id: string) => {
    const href = hrefFor(id);
    return href ? `[${label}](${href})` : label;
  });
}
