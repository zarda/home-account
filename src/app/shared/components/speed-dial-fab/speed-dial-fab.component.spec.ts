import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SpeedDialFabComponent, SpeedDialAction } from './speed-dial-fab.component';

describe('SpeedDialFabComponent', () => {
  let component: SpeedDialFabComponent;
  let fixture: ComponentFixture<SpeedDialFabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpeedDialFabComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(SpeedDialFabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts closed', () => {
    expect(component.isOpen()).toBeFalse();
  });

  it('toggle flips the open state', () => {
    component.toggle();
    expect(component.isOpen()).toBeTrue();
    component.toggle();
    expect(component.isOpen()).toBeFalse();
  });

  it('close sets the open state to false', () => {
    component.toggle();
    component.close();
    expect(component.isOpen()).toBeFalse();
  });

  it('onActionClick emits the action id and closes the menu', () => {
    const emitted: string[] = [];
    component.actionClick.subscribe((id) => emitted.push(id));
    component.toggle();

    component.onActionClick('add-income');

    expect(emitted).toEqual(['add-income']);
    expect(component.isOpen()).toBeFalse();
  });

  describe('visibleActions', () => {
    const actions: SpeedDialAction[] = [
      { id: 'a', icon: 'add', label: 'A' },
      { id: 'b', icon: 'remove', label: 'B', visible: true },
      { id: 'c', icon: 'edit', label: 'C', visible: false },
    ];

    it('keeps actions unless explicitly hidden', () => {
      component.actions = actions;
      expect(component.visibleActions.map((a) => a.id)).toEqual(['a', 'b']);
    });

    it('returns an empty list when there are no actions', () => {
      component.actions = [];
      expect(component.visibleActions).toEqual([]);
    });
  });
});
