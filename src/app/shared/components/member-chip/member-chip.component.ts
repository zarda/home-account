import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { HouseholdMemberIdentity, isMemberPhotoUrl } from '../../../models';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * A household member as a small avatar beside their name.
 *
 * The name is always written out: an avatar alone cannot tell two members
 * apart when neither has a picture and their initials match, and it gives a
 * screen reader nothing to say. So the avatar is decoration, hidden from
 * assistive technology, and what the chip reads as is the name.
 *
 * It takes its size from the text around it, so the same chip sits on a
 * transaction row's small meta line and on a totals line.
 *
 * Each member writes their own picture address, and every viewer's browser
 * would fetch it. Only an address on the sign-in provider's picture hosts is
 * loaded, whatever a document holds: any other shows the initial and fetches
 * nothing.
 */
@Component({
  selector: 'app-member-chip',
  standalone: true,
  imports: [MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './member-chip.component.html',
  styleUrl: './member-chip.component.scss'
})
export class MemberChipComponent {
  member = input.required<HouseholdMemberIdentity>();

  // Resets whenever the picture's address changes, so a failure never
  // outlives the picture that failed.
  protected readonly photoFailed = linkedSignal({
    source: () => this.member().photoURL,
    computation: () => false
  });

  protected readonly photo = computed(() => {
    const url = this.member().photoURL;
    return !this.photoFailed() && isMemberPhotoUrl(url) ? url : null;
  });

  /** Empty when the member gave no name: the rules allow that. */
  protected readonly name = computed(() => this.member().displayName.trim());

  // By code point, so a name that opens with a character outside the Basic
  // Multilingual Plane is not split in half.
  protected readonly initial = computed(() => Array.from(this.name())[0]?.toLocaleUpperCase() ?? '');
}
