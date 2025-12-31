import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { DateFormatService } from './date-format.service';

describe('DateFormatService', () => {
  let service: DateFormatService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DateFormatService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('formatDate', () => {
    it('should format a Date object', () => {
      const date = new Date(2024, 0, 15); // Jan 15, 2024
      const result = service.formatDate(date);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should format a Firestore Timestamp', () => {
      const date = new Date(2024, 5, 20); // Jun 20, 2024
      const timestamp = {
        toDate: () => date,
        seconds: Math.floor(date.getTime() / 1000),
        nanoseconds: 0
      } as Timestamp;

      const result = service.formatDate(timestamp);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  describe('formatRelativeDate', () => {
    it('should return "Today" for today\'s date', () => {
      const today = new Date();
      const result = service.formatRelativeDate(today);
      expect(result).toBe('Today');
    });

    it('should return "Yesterday" for yesterday\'s date', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const result = service.formatRelativeDate(yesterday);
      expect(result).toBe('Yesterday');
    });

    it('should return weekday for dates within the last 7 days', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const result = service.formatRelativeDate(threeDaysAgo);
      // Should be a short weekday like "Mon", "Tue", etc.
      expect(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).toContain(result);
    });

    it('should return short date for older dates', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);
      const result = service.formatRelativeDate(oldDate);
      // Should be in format like "Dec 1" or "Nov 30"
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    });

    it('should handle Firestore Timestamp for today', () => {
      const today = new Date();
      const timestamp = {
        toDate: () => today,
        seconds: Math.floor(today.getTime() / 1000),
        nanoseconds: 0
      } as Timestamp;

      const result = service.formatRelativeDate(timestamp);
      expect(result).toBe('Today');
    });

    it('should handle Firestore Timestamp for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const timestamp = {
        toDate: () => yesterday,
        seconds: Math.floor(yesterday.getTime() / 1000),
        nanoseconds: 0
      } as Timestamp;

      const result = service.formatRelativeDate(timestamp);
      expect(result).toBe('Yesterday');
    });
  });
});
