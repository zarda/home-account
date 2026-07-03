import { BUDGET_ALERT_THRESHOLDS, getBudgetAlertSeverity } from './budget-alert.utils';

describe('budget-alert.utils', () => {
  describe('BUDGET_ALERT_THRESHOLDS', () => {
    it('should pin the shared severity thresholds', () => {
      expect(BUDGET_ALERT_THRESHOLDS).toEqual({ exceeded: 100, critical: 90, warning: 80 });
    });
  });

  describe('getBudgetAlertSeverity', () => {
    it('should return null under the default warning threshold', () => {
      expect(getBudgetAlertSeverity(0)).toBeNull();
      expect(getBudgetAlertSeverity(50)).toBeNull();
      expect(getBudgetAlertSeverity(79.9)).toBeNull();
    });

    it('should return warning from the default threshold up to 90%', () => {
      expect(getBudgetAlertSeverity(80)).toBe('warning');
      expect(getBudgetAlertSeverity(89.9)).toBe('warning');
    });

    it('should respect a custom per-budget warning threshold', () => {
      expect(getBudgetAlertSeverity(70, 60)).toBe('warning');
      expect(getBudgetAlertSeverity(59, 60)).toBeNull();
    });

    it('should return critical from 90% up to 100%', () => {
      expect(getBudgetAlertSeverity(90)).toBe('critical');
      expect(getBudgetAlertSeverity(99.9)).toBe('critical');
    });

    it('should return exceeded at 100% and above', () => {
      expect(getBudgetAlertSeverity(100)).toBe('exceeded');
      expect(getBudgetAlertSeverity(250)).toBe('exceeded');
    });

    it('should return critical and exceeded even when the custom threshold is higher', () => {
      expect(getBudgetAlertSeverity(92, 95)).toBe('critical');
      expect(getBudgetAlertSeverity(101, 120)).toBe('exceeded');
    });
  });
});
