/// <reference types="jasmine" />

/** What a drag needs of the fixture it runs in: the page it drew, and a render. */
interface DragFixture {
  readonly nativeElement: unknown;
  detectChanges(): void;
}

/**
 * The upload area's listed row under `root` that shows `name`; never the
 * slot or the preview a drag leaves.
 */
export function fileRowOf(root: ParentNode, name: string): HTMLElement | undefined {
  return Array.from(
    root.querySelectorAll<HTMLElement>('.file-list > .file-item:not(.cdk-drag-placeholder):not(.cdk-drag-preview)')
  ).find(row => row.querySelector('.file-name')?.textContent?.trim() === name);
}

/** One mouse event as a mouse makes it: the left button held from its press until its release. */
export function mouse(target: EventTarget, type: 'mousedown' | 'mousemove' | 'mouseup', x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    detail: 1,
  }));
}

/**
 * A real drag of the photo `dragged` by its handle onto the row that shows
 * `over`, the way a mouse makes one, on the upload area `fixture` drew,
 * whether alone or inside the wizard. The press lands on the handle with a
 * button held and a click count, or CDK takes it for a screen reader's; the
 * first move goes past CDK's 5px start threshold, toward `over`, and starts
 * the drag; the second puts the pointer in the middle of `over`'s row, where
 * it is held; one render runs there, as the zone would run one once CDK
 * starts the drag, so host-bound drag classes are current. Then `during`
 * runs, once the pointer has been held past the 200ms glide of the rows CDK
 * slides aside, so a row's drawn place is the one a user sees rather than
 * where its glide starts. The release always follows, and the drop lands
 * only once the dragged row has glided into its slot, a 200ms transition
 * provideNoMotion does not reach: so after the release no render runs until
 * no preview is left.
 */
export async function dragByHandle(
  fixture: DragFixture,
  dragged: string,
  over: string,
  during: () => void
): Promise<void> {
  const root = fixture.nativeElement as HTMLElement;
  const handle = fileRowOf(root, dragged)?.querySelector<HTMLElement>('.drag-handle');
  const target = fileRowOf(root, over);
  expect(handle).withContext(`${dragged}'s drag handle`).toBeTruthy();
  expect(target).withContext(`${over}'s row`).toBeTruthy();
  if (!handle || !target) return;

  const grip = handle.getBoundingClientRect();
  const onto = target.getBoundingClientRect();
  const x = grip.left + grip.width / 2;
  const y = grip.top + grip.height / 2;
  const held = onto.top + onto.height / 2;
  mouse(handle, 'mousedown', x, y);
  try {
    mouse(document, 'mousemove', x, y + (held < y ? -6 : 6));
    mouse(document, 'mousemove', x, held);
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 250));
    during();
  } finally {
    mouse(document, 'mouseup', x, held);
    const deadline = Date.now() + 2000;
    while (document.querySelector('.cdk-drag-preview') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(document.querySelector('.cdk-drag-preview')).withContext('the preview, once the drop settles').toBeNull();
    fixture.detectChanges();
  }
}
