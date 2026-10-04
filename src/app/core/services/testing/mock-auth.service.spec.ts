import { MockAuthService, createMockUser } from './mock-auth.service';

/**
 * The double's nested preference write, which the layout specs lean on: it
 * must change the signal the way the real service does, or a spec passes on
 * a state no real write produces.
 */
describe('MockAuthService', () => {
  let mock: MockAuthService;
  const ORDER = ['budgets', 'chart', 'recent', 'upcoming', 'insights'];

  beforeEach(() => {
    mock = new MockAuthService();
  });

  describe('updatePreferenceFields', () => {
    it('rejects when no user is signed in, as the real service does', async () => {
      await expectAsync(
        mock.updatePreferenceFields('dashboardLayout', { hidden: { set: ['insights'] } })
      ).toBeRejectedWithError('No authenticated user');
    });

    it('sets and deletes fields one level down, keeping the rest of the map', async () => {
      const user = createMockUser();
      mock.setMockUser({
        ...user,
        preferences: { ...user.preferences, dashboardLayout: { order: ORDER, hidden: ['chart'] } }
      });

      await mock.updatePreferenceFields('dashboardLayout', {
        hidden: { set: ['insights', 'future-card'] }
      });
      expect(mock.currentUser()!.preferences.dashboardLayout).toEqual({
        order: ORDER,
        hidden: ['insights', 'future-card']
      });

      await mock.updatePreferenceFields('dashboardLayout', { order: { delete: true } });
      expect(mock.currentUser()!.preferences.dashboardLayout).toEqual({
        hidden: ['insights', 'future-card']
      });
    });

    it('leaves the signal as it was for an empty field set', async () => {
      mock.setAuthenticated(true);
      const before = mock.currentUser();

      await mock.updatePreferenceFields('dashboardLayout', {});

      expect(mock.currentUser()).toBe(before);
    });

    it('records every call, and clearMocks forgets them', async () => {
      mock.setAuthenticated(true);
      await mock.updatePreferenceFields('dashboardLayout', { hidden: { set: ['insights'] } });

      expect(mock.updatePreferenceFieldsSpy).toHaveBeenCalledOnceWith('dashboardLayout', {
        hidden: { set: ['insights'] }
      });

      mock.clearMocks();

      expect(mock.updatePreferenceFieldsSpy).not.toHaveBeenCalled();
    });
  });
});
