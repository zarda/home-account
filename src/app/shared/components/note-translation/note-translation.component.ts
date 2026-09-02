import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Signal,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { NoteTranslation } from '../../../core/services/llm-provider.interface';
import { NoteTranslationService } from '../../../core/services/note-translation.service';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

/** Marks the reset effect's first pass, before any note has been observed. */
const NOTE_UNSEEN = Symbol('note not yet observed');

/**
 * The translation lens for one note: a button that reads the note back in the
 * app's language, and the panel showing what came back.
 *
 * Reusable rather than built into a screen because the same note is read from
 * three places (the list, the detail dialog, the edit form) and the lens has
 * to behave identically in each. It owns the request and the failure, and
 * reports only whether the translation is currently standing in for the note:
 * a host that shows the original itself hides it while `showingTranslation`.
 *
 * Nothing is written anywhere. The translation lives in this component and in
 * the service's session cache, and both are gone when the page reloads.
 */
@Component({
  selector: 'app-note-translation',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, LoadingSpinnerComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './note-translation.component.html',
  styleUrl: './note-translation.component.scss',
})
export class NoteTranslationComponent {
  private noteTranslation = inject(NoteTranslationService);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private host = inject(ElementRef<HTMLElement>);

  // Read as elements, not as the MatButton components the refs would
  // otherwise resolve to — focus() lives on the DOM node.
  private translateButton = viewChild('translateButton', { read: ElementRef<HTMLElement> });
  private showOriginalButton = viewChild('showOriginalButton', {
    read: ElementRef<HTMLElement>,
  });
  private retryButton = viewChild('retryButton', { read: ElementRef<HTMLElement> });

  readonly note = input.required<string>();

  /** Two-way, because the host hides its own copy of the note while this is true. */
  readonly showingTranslation = model(false);

  readonly translation = signal<NoteTranslation | null>(null);
  readonly isLoading = signal(false);
  readonly errorKey = signal<string | null>(null);

  readonly available = this.noteTranslation.available;

  /** A note with no text in it has nothing to translate, so the lens stays away. */
  readonly hasNote = computed(() => this.note().trim().length > 0);

  readonly shownTranslation = computed(() =>
    this.showingTranslation() ? this.translation() : null
  );

  /** The note last seen by the reset effect, to tell an edit from its first run. */
  private lastSeenNote: string | typeof NOTE_UNSEEN = NOTE_UNSEEN;

  /**
   * Bumped by every request that starts and by every reset, so an `await`
   * resuming after either can tell whether it is still the one anyone asked
   * for. Requests are otherwise indistinguishable by note text alone: editing
   * away and back asks the same question twice.
   */
  private requestToken = 0;

  constructor() {
    // An edited note is a different note: keeping the panel would leave the
    // reader looking at a translation of text that is no longer there. But
    // the effect's first run happens on the first change-detection pass, not
    // on an edit — resetting then would discard a `showingTranslation` the
    // host bound before it ever ran.
    effect(() => {
      const note = this.note();
      if (this.lastSeenNote === NOTE_UNSEEN) {
        this.lastSeenNote = note;
        return;
      }
      if (note === this.lastSeenNote) {
        return;
      }
      this.lastSeenNote = note;
      this.reset();
    });
  }

  /**
   * Ask for the translation, or put an answered one back on screen.
   *
   * Re-showing costs nothing — the answer is still here — which is what makes
   * flipping between the note and its translation worth offering at all.
   */
  async translateNote(): Promise<void> {
    if (this.isLoading()) {
      return;
    }
    if (this.translation()) {
      this.showingTranslation.set(true);
      this.focusWhenRendered(this.showOriginalButton);
      return;
    }

    const asked = this.note();
    const token = ++this.requestToken;
    this.errorKey.set(null);
    this.isLoading.set(true);
    try {
      const translated = await this.noteTranslation.translate(asked);
      // The note can be edited while the model is answering — in the form it
      // routinely is — including back to text a still-running request also
      // asked about. The token, not the text, says which request this is.
      if (token !== this.requestToken) {
        return;
      }
      this.translation.set(translated);
      this.showingTranslation.set(true);
      this.focusWhenRendered(this.showOriginalButton);
    } catch (error) {
      if (token !== this.requestToken) {
        return;
      }
      this.errorKey.set(this.noteTranslation.failureKey(error));
      this.focusWhenRendered(this.retryButton);
    } finally {
      // Guarded like the two branches above: the edit already cleared this
      // flag, and a request started for the new note may well be running by
      // now — clearing it again would take that one's spinner down with it.
      if (token === this.requestToken) {
        this.isLoading.set(false);
      }
    }
  }

  /** Back to the note as written; the translation is kept for an instant re-show. */
  showOriginal(): void {
    this.showingTranslation.set(false);
    this.focusWhenRendered(this.translateButton);
  }

  /**
   * Put focus on the control that takes the place of the one just pressed.
   *
   * Each direction removes its own button in the same tick as the click:
   * Translate goes as soon as the request starts, and Show original goes with
   * the panel holding it. Focus would land on `<body>`, so a keyboard reader
   * would have to walk the whole surface again to get back to the note they
   * were reading. afterNextRender is the first moment the replacement exists
   * to receive it.
   */
  private focusWhenRendered(target: Signal<ElementRef<HTMLElement> | undefined>): void {
    // An answer can land after the view is gone — the form's lens is inside a
    // dialog the user can close mid-request. Registering on the destroyed
    // injector throws NG0911, and there is nothing left to focus anyway.
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => {
      // A model can take seconds to answer, and the lens sits beside an
      // editable note: whoever is typing in that textarea when the answer
      // lands keeps the caret. Only focus this lens abandoned — on <body>
      // because the pressed button was just removed, or still somewhere
      // inside this host — is focus this lens may move.
      const active = document.activeElement;
      const abandoned =
        active === null || active === document.body || this.host.nativeElement.contains(active);
      if (!abandoned) return;
      target()?.nativeElement.focus();
    }, { injector: this.injector });
  }

  private reset(): void {
    // Bumping the token orphans any request still in flight for the note
    // this reset just left behind, so its answer or error lands as a no-op.
    this.requestToken++;
    this.translation.set(null);
    this.errorKey.set(null);
    this.isLoading.set(false);
    this.showingTranslation.set(false);
  }
}
