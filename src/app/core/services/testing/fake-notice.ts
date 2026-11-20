import { ActionNotice } from '../notification.service';

/**
 * A notice with an action as its caller sees it, driven by the spec:
 * pressing its action, the dismissal Material reports once the notice has
 * left (which may come after the next notice has opened), and the pointer or
 * focus holding it.
 */
export class FakeNotice implements ActionNotice {
  dismissCalls = 0;
  private actionHandlers: (() => void)[] = [];
  private dismissHandlers: ((byAction: boolean) => void)[] = [];
  private holdHandlers: ((held: boolean) => void)[] = [];

  constructor(readonly message: string, readonly action: string) {}

  onAction(handler: () => void): void {
    this.actionHandlers.push(handler);
  }

  afterDismissed(handler: (byAction: boolean) => void): void {
    this.dismissHandlers.push(handler);
  }

  onHold(handler: (held: boolean) => void): void {
    this.holdHandlers.push(handler);
  }

  dismiss(): void {
    this.dismissCalls += 1;
  }

  /** The reader presses the action; Material then reports the dismissal as by action. */
  press(): void {
    for (const handler of this.actionHandlers) handler();
    this.left(true);
  }

  /** Material's report that the notice has left the screen. */
  left(byAction = false): void {
    for (const handler of this.dismissHandlers) handler(byAction);
  }

  hold(held: boolean): void {
    for (const handler of this.holdHandlers) handler(held);
  }
}
