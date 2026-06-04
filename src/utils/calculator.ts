import { Holiday, CalculationResult } from '../types';

export function parseTimeToDecimal(timeStr: string): number {
  if (!timeStr || !timeStr.trim()) return 0;
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) {
    // Try simple number parsing if format is e.g. "8" or "17"
    const val = parseFloat(timeStr);
    return isNaN(val) ? 0 : val;
  }
  const hrs = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  return hrs + mins / 60;
}

export function formatDecimalToTime(decimal: number): string {
  if (decimal <= 0) return '00:00';
  const hrs = Math.floor(decimal);
  const mins = Math.round((decimal - hrs) * 60);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function isHoliday(dateStr: string, holidays: Holiday[]): { check: boolean; name: string } {
  if (!dateStr) return { check: false, name: '' };
  const targetDate = dateStr.trim();
  const found = holidays.find(h => h.holidayDate === targetDate);
  if (found) {
    return { check: true, name: found.holidayName };
  }
  return { check: false, name: '' };
}

export function getDayOfWeek(dateStr: string): number {
  // Returns 0 for Sunday, 1 for Monday, ..., 6 for Saturday
  if (!dateStr) return -1;
  const d = new Date(dateStr);
  return d.getDay();
}

export function calculateEntryOT(
  dateStr: string,
  timeInStr: string,
  timeOutStr: string,
  lunchDeductFlag: number, // 1 to deduct lunch, 0 otherwise
  lunchOTFlag: number, // G-column: 1 if worked during lunch
  isFlatRateEmployee: boolean,
  holidays: Holiday[],
  projectName?: string,
  workScheduleType?: string,
  position?: string
): CalculationResult {
  if (!dateStr || !timeInStr || !timeOutStr) {
    return { normalHours: 0, ot15Hours: 0, ot20Hours: 0, ot30Hours: 0, totalHours: 0 };
  }

  const timeIn = parseTimeToDecimal(timeInStr);
  let timeOut = parseTimeToDecimal(timeOutStr);

  // If timeOut is less than timeIn, the shift crossed midnight (overnight shift)
  if (timeOut < timeIn) {
    timeOut += 24;
  }

  let totalElapsed = timeOut - timeIn;
  if (totalElapsed < 0) totalElapsed = 0;

  // Standard break subtraction
  let breakHours = 0;
  // If the total elapsed hours is 5.0 or more, we automatically deduct a 1-hour lunch break.
  // This removes the need for a manual "lunchDeduct" checkbox and handles Saturday half-days perfectly.
  if (totalElapsed >= 5.0) {
    breakHours = 1.0;
  }

  // Work hours without break
  let actualWorkHours = Math.max(0, totalElapsed - breakHours);

  // G-Column (Working lunch): If they worked through lunch
  // That means we add lunch OT hour back, or rather, the worked hour during lunch is extra OT
  let addedLunchOT = lunchOTFlag === 1 ? 1.0 : 0.0;

  // Let's identify the day status
  const { check: isPubHoliday, name: holidayName } = isHoliday(dateStr, holidays);
  const dayOfWeek = getDayOfWeek(dateStr);
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;
  const isOffshore = projectName ? projectName.toLowerCase().includes('offshore') : false;

  // New strict rule: If project is Offshore, it has fixed daily rate, OT is never calculated or shown
  if (isOffshore) {
    const defaultHours = actualWorkHours > 0 ? 8.0 : 0.0;
    return {
      normalHours: defaultHours,
      ot15Hours: 0,
      ot20Hours: 0,
      ot30Hours: 0,
      totalHours: defaultHours
    };
  }

  // 1. Flat Rate rule:
  // Flat rate means work 12 hours/day for one single rate.
  // No OT is counted for flat rate.
  if (isFlatRateEmployee) {
    const hours = Math.min(12, actualWorkHours + addedLunchOT);
    return {
      normalHours: Number(hours.toFixed(2)),
      ot15Hours: 0,
      ot20Hours: 0,
      ot30Hours: 0,
      totalHours: Number(hours.toFixed(2))
    };
  }

  // Define outputs
  let normalHours = 0;
  let ot15Hours = 0;
  let ot20Hours = 0;
  let ot30Hours = 0;

  const isDailyWorker =
    workScheduleType === 'daily_worker' ||
    (position && position.toLowerCase().includes('daily'));

  // 2. Holiday or Sunday calculation rules (bypassed if offshore)
  if ((isPubHoliday || isSunday) && !isOffshore) {
    // Normal hours are 0 for holidays, but they do work and get holiday pay rates.
    // Under standard Thai labor law:
    // First 8 hours on Sunday / Public Holiday are paid as OT 2.0 (for daily workers) or OT 1.0 (for monthly)
    // We will allocate the first 8 hours to OT 2.0 (which is the Holiday Normal rate column)
    // Hours beyond 8 hours are paid as Holiday Overtime at OT 3.0
    const mainWorkHours = actualWorkHours;
    
    const limit = 8.0;
    const baseHolidayHours = Math.min(limit, mainWorkHours);
    const excessHolidayHours = Math.max(0, mainWorkHours - limit);

    ot20Hours = baseHolidayHours;
    ot30Hours = excessHolidayHours;

    // Adjust for Lunch OT
    if (addedLunchOT > 0) {
      // Worked lunch counts as holiday overtime. Since lunch is during the primary shift,
      // if total hours <= 8, it can be paid as OT 2.0. If above, it's OT 3.0.
      // Usually, work during break is considered extra OT, so we add it to OT 3.0 to be safe,
      // or if they didn't exceed 8 hours, it's OT 2.0.
      if (ot20Hours + addedLunchOT <= 8.0) {
        ot20Hours += addedLunchOT;
      } else {
        const spaceLeft = Math.max(0, 8.0 - ot20Hours);
        ot20Hours += spaceLeft;
        ot30Hours += (addedLunchOT - spaceLeft);
      }
    }

    normalHours = 0; // Holidays have no weekday "normal hours"
  } 
  // 3. Saturday calculation rules (bypassed if offshore)
  else if (isSaturday && !isOffshore) {
    if (isDailyWorker) {
      // "พนักงานที่มีตำแหน่ง Daily Worker ปรับวันทำจันทร์ - เสาร์ เป็นวันทำงานปกติ"
      // Normal hours are up to 8.0, and after-hours are OT 1.5.
      const mainWorkHours = actualWorkHours;
      normalHours = Math.min(8.0, mainWorkHours);
      ot15Hours = Math.max(0, mainWorkHours - 8.0);

      // Keyed lunch break worked (Lunch OT Flag = 1):
      // Calculated as 1.0 hour of OT 1.5.
      if (addedLunchOT > 0) {
        ot15Hours += addedLunchOT;
      }
    } else {
      // "ส่วนตำแหน่งอื่นๆ วันเสาร์ 08:00-12:00 นับ 4 ชั่วโมง หลังจาก 4 ชั่วโมง คือโอที 1.5"
      const mainWorkHours = actualWorkHours;
      normalHours = Math.min(4.0, mainWorkHours);
      ot15Hours = Math.max(0, mainWorkHours - 4.0);

      // If Lunch OT (คีย์ 1): Worked during break (which on Saturday is 12:00-13:00).
      // This adds 1.0 hour to OT 1.5.
      if (addedLunchOT > 0) {
        ot15Hours += addedLunchOT;
      }
    }
  } 
  // 4. Normal Weekday (Mon-Fri) rules
  else {
    // Weekday: 8 Normal hours, and after-hours are OT 1.5.
    // Lunch break worked (LunchOT = 1) counts as OT 1.5.
    
    // Let's handle night shift overtime first or standard daytime overtime
    // Under night shift: e.g. 20:00 to 05:00 is normal 8 hours.
    // If they work beyond 05:00 (e.g. until 07:00), the 2 hours after 05:00 are OT 1.5.
    const mainWorkHours = actualWorkHours;
    
    normalHours = Math.min(8.0, mainWorkHours);
    ot15Hours = Math.max(0, mainWorkHours - 8.0);

    // Add Lunch OT to OT 1.5
    if (addedLunchOT > 0) {
      ot15Hours += addedLunchOT;
    }
  }

  // Format calculations to 2 decimal places to prevent float rounding errors
  normalHours = Number(normalHours.toFixed(2));
  ot15Hours = Number(ot15Hours.toFixed(2));
  ot20Hours = Number(ot20Hours.toFixed(2));
  ot30Hours = Number(ot30Hours.toFixed(2));
  const total = Number((normalHours + ot15Hours + ot20Hours + ot30Hours).toFixed(2));

  return {
    normalHours,
    ot15Hours,
    ot20Hours,
    ot30Hours,
    totalHours: total
  };
}
