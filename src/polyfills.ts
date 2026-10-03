/** `ParentNode.replaceChildren` is Safari 14 / Chrome 86 / Firefox 78+, and
 *  the app calls it on every list render. Older engines that still parse the
 *  bundle logged "replaceChildren is not a function" (#666), so shim it with
 *  the spec behaviour: drop all children, then append the given nodes. */
type WithReplace = { replaceChildren?: (...nodes: (Node | string)[]) => void };

function replaceChildren(this: ParentNode, ...nodes: (Node | string)[]): void {
  while (this.lastChild) this.removeChild(this.lastChild);
  this.append(...nodes);
}

for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
  const p = proto as unknown as WithReplace;
  if (typeof p.replaceChildren !== 'function') p.replaceChildren = replaceChildren;
}

export {};
