import { createClient } from '@supabase/supabase-js';

// Load values from environment or fallback to user's explicit credential settings
const metaEnv = (import.meta as any).env || {};

// Robustly clean up VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to avoid trailing slashes, spaces, or surrounding quotes
const cleanUrl = (metaEnv.VITE_SUPABASE_URL || 'https://mtwnkkhcgopbrsoztykv.supabase.co')
  .trim()
  .replace(/^["']|["']$/g, '')
  .trim();

const supabaseUrl = cleanUrl.endsWith('/') ? cleanUrl.replace(/\/+$/, '') : cleanUrl;

const supabaseAnonKey = (metaEnv.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10d25ra2hjZ29wYnJzb3p0eWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MzEzMDEsImV4cCI6MjA5NDIwNzMwMX0.i3ifZMuKpElWKKhHWcgRSrhlsgXAtATN7XSQorsiu5g')
  .trim()
  .replace(/^["']|["']$/g, '')
  .trim();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cache of resolved table names to avoid probing on every single query
const resolvedTableNames: Record<string, string> = {};

/**
 * Resiliently probes Supabase to see which table name candidate is available (case-insensitive fallback).
 * Caches the resolved table name for all subsequent database requests to run instantly.
 */
async function getTableRef(preferredName: string, fallbacks: string[]): Promise<string> {
  if (resolvedTableNames[preferredName]) {
    return resolvedTableNames[preferredName];
  }

  const rawCandidates = [preferredName, ...fallbacks];
  const candidatesSet = new Set<string>();
  for (const c of rawCandidates) {
    if (c) {
      candidatesSet.add(c);
      candidatesSet.add(c.toLowerCase());
      candidatesSet.add(c.toLowerCase().replace(/[-_]/g, ''));
    }
  }
  const candidates = Array.from(candidatesSet);
  
  // Try to find a candidate that succeeds with absolutely no error first
  for (const candidate of candidates) {
    try {
      const { error } = await supabase
        .from(candidate)
        .select('*')
        .limit(1);

      if (!error) {
        resolvedTableNames[preferredName] = candidate;
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  // If none succeeded with 0 errors (e.g. permission/auth/RLS), find the first one that is NOT a "missing table" error
  for (const candidate of candidates) {
    try {
      const { error } = await supabase
        .from(candidate)
        .select('*')
        .limit(1);

      if (error) {
        const errorMsg = (error.message || '').toLowerCase();
        const code = error.code || '';
        if (
          errorMsg.includes('invalid path') || 
          errorMsg.includes('does not exist') || 
          errorMsg.includes('not found') ||
          errorMsg.includes('schema cache') ||
          code === 'PGRST116' ||
          code === '42P01' ||
          code === 'PGRST205'
        ) {
          continue;
        }
      }

      resolvedTableNames[preferredName] = candidate;
      return candidate;
    } catch {
      // ignore
    }
  }

  resolvedTableNames[preferredName] = preferredName;
  return preferredName;
}

export interface SupabaseSyncState {
  connected: boolean;
  message: string;
}

// -------------------------------------------------------------
// Core Database Sync Methods
// -------------------------------------------------------------

/**
 * Fetch all employees from Supabase EmployeeRates table.
 * If tables aren't created yet or fall back occurs, returns null.
 */
export async function dbFetchEmployees() {
  try {
    const tableName = await getTableRef('EmployeeRates', ['employeerates', 'employee_rates']);
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('EmployeeID', { ascending: true });

    if (error) throw error;
    
    // Map database snake/Pascal case columns back to our App-level Employee interface
    if (data) {
      return data.map((item: any) => ({
        id: item.EmployeeID,
        employeeName: item.EmployeeName,
        staffSalary: Number(item.StaffSalary || 0),
        officeSalary: Number(item.OfficeSalary || 0),
        transportationRate: Number(item.TransportationRate || 0),
        workshopRate: Number(item.WorkshopRate || 0),
        onsiteRate: Number(item.OnsiteRate || 0),
        offshoreRate: Number(item.OffshoreRate || 0),
        wfhRate: Number(item.WFHRate || 0),
        position: item.Position || 'พนักงาน',
        status: item.Status || 'active',
        bankName: item.BankName || '',
        bankAccount: item.BankAccount || '',
        studentLoan: Number(item.StudentLoan || 0),
        workScheduleType: item.WorkScheduleType || 'daily_worker',
        isFlatRate: !!item.isFlatRate
      }));
    }
    return null;
  } catch (err: any) {
    console.warn('⚡ Supabase EmployeeRates read warning:', err.message);
    return null;
  }
}

/**
 * Inserts or updates an employee in EmployeeRates table
 */
export async function dbUpsertEmployee(emp: any) {
  try {
    const tableName = await getTableRef('EmployeeRates', ['employeerates', 'employee_rates']);
    const dbPayload = {
      EmployeeID: emp.id,
      EmployeeName: emp.employeeName.toUpperCase(),
      StaffSalary: parseFloat(emp.staffSalary || emp.officeSalary || 0),
      OfficeSalary: parseFloat(emp.officeSalary || emp.staffSalary || 0),
      TransportationRate: parseFloat(emp.transportationRate || 0),
      WorkshopRate: parseFloat(emp.workshopRate || 0),
      OnsiteRate: parseFloat(emp.onsiteRate || 0),
      OffshoreRate: parseFloat(emp.offshoreRate || 0),
      WFHRate: parseFloat(emp.wfhRate || 0),
      Position: emp.position,
      Status: emp.status,
      BankName: emp.bankName,
      BankAccount: emp.bankAccount,
      StudentLoan: parseFloat(emp.studentLoan || 0),
      WorkScheduleType: emp.workScheduleType,
      isFlatRate: !!emp.isFlatRate
    };

    const { error } = await supabase
      .from(tableName)
      .upsert(dbPayload, { onConflict: 'EmployeeID' });

    if (error) throw error;
    return true;
  } catch (err: any) {
    console.error('❌ Supabase EmployeeRates write error:', err.message);
    return false;
  }
}

/**
 * Removes an employee from EmployeeRates
 */
export async function dbDeleteEmployee(id: string) {
  try {
    const tableName = await getTableRef('EmployeeRates', ['employeerates', 'employee_rates']);
    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq('EmployeeID', id);

    if (error) throw error;
    return true;
  } catch (err: any) {
    console.error('❌ Supabase Delete Employee Error:', err.message);
    return false;
  }
}

/**
 * Fetch TIMESHEET records
 */
export async function dbFetchTimesheets() {
  try {
    const tableName = await getTableRef('TIMESHEET', ['timesheet', 'Timesheet']);
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('Date', { ascending: false });

    if (error) throw error;

    if (data) {
      return data.map((item: any) => ({
        id: item.ID,
        employeeName: item.EmployeeName,
        date: item.Date,
        project: item.Project || 'workshop',
        timeIn: item.TimeIn || '08:00',
        timeOut: item.TimeOut || '17:00',
        lunchDeduct: Number(item.LunchDeduct ?? 1),
        lunchOT: Number(item.LunchOT ?? 0),
        flatRate: false, // will match with employee profiles dynamically
        normalHours: Number(item.NormalHours || 0),
        ot15Hours: Number(item.OT15Hours || 0),
        ot20Hours: Number(item.OT20Hours || 0),
        ot30Hours: Number(item.OT30Hours || 0),
        remark: item.Remark || '',
        status: item.Status || 'Pending',
        createdAt: item.CreatedAt,
        updatedAt: item.UpdatedAt
      }));
    }
    return null;
  } catch (err: any) {
    console.warn('⚡ Supabase TIMESHEET read warning:', err.message);
    return null;
  }
}

/**
 * Upsert Timesheet Entries
 */
export async function dbUpsertTimesheet(entry: any) {
  try {
    const tableName = await getTableRef('TIMESHEET', ['timesheet', 'Timesheet']);
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id || '');
    const dbPayload: any = {
      EmployeeName: entry.employeeName,
      Date: entry.date,
      Project: entry.project || 'workshop',
      TimeIn: entry.timeIn,
      TimeOut: entry.timeOut,
      LunchDeduct: Number(entry.lunchDeduct ?? 1),
      LunchOT: Number(entry.lunchOT ?? 0),
      NormalHours: parseFloat(entry.normalHours || 0),
      OT15Hours: parseFloat(entry.ot15Hours || 0),
      OT20Hours: parseFloat(entry.ot20Hours || 0),
      OT30Hours: parseFloat(entry.ot30Hours || 0),
      Remark: entry.remark || '',
      Status: entry.status || 'Pending'
    };

    if (isUUID) {
      dbPayload.ID = entry.id;
    }

    // If ID is valid UUID, we use it for upsert, else omit to let Postgres generate UUID
    const { error } = await supabase
      .from(tableName)
      .upsert(dbPayload, { onConflict: 'ID' });

    if (error) throw error;
    return true;
  } catch (err: any) {
    console.error('❌ Supabase TIMESHEET write error:', err.message);
    return false;
  }
}

/**
 * Delete Timesheet entry
 */
export async function dbDeleteTimesheet(id: string) {
  try {
    const tableName = await getTableRef('TIMESHEET', ['timesheet', 'Timesheet']);
    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq('ID', id);

    if (error) throw error;
    return true;
  } catch (err: any) {
    // If not UUID, eq ID might fail, so check fallback
    console.error('❌ Supabase TIMESHEET delete warning:', err.message);
    return false;
  }
}

/**
 * Multi Bulk Save entries (ideal for paste/imports)
 */
export async function dbBulkInsertTimesheets(entries: any[]) {
  if (!entries || entries.length === 0) {
    return true;
  }
  try {
    const tableName = await getTableRef('TIMESHEET', ['timesheet', 'Timesheet']);
    const dbPayloads = entries.map(entry => {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id || '');
      const item: any = {
        EmployeeName: entry.employeeName,
        Date: entry.date,
        Project: entry.project || 'workshop',
        TimeIn: entry.timeIn,
        TimeOut: entry.timeOut,
        LunchDeduct: Number(entry.lunchDeduct ?? 1),
        LunchOT: Number(entry.lunchOT ?? 0),
        NormalHours: parseFloat(entry.normalHours || 0),
        OT15Hours: parseFloat(entry.ot15Hours || 0),
        OT20Hours: parseFloat(entry.ot20Hours || 0),
        OT30Hours: parseFloat(entry.ot30Hours || 0),
        Remark: entry.remark || '',
        Status: entry.status || 'Pending'
      };
      if (isUUID) {
        item.ID = entry.id;
      }
      return item;
    });

    const { error } = await supabase
      .from(tableName)
      .insert(dbPayloads);

    if (error) throw error;
    return true;
  } catch (err: any) {
    console.error('❌ Supabase TIMESHEET Bulk Insert Error:', err.message);
    return false;
  }
}

/**
 * Truncate TIMESHEET table
 */
export async function dbClearAllTimesheets() {
  try {
    const tableName = await getTableRef('TIMESHEET', ['timesheet', 'Timesheet']);
    const { error } = await supabase
      .from(tableName)
      .delete()
      .neq('EmployeeName', 'SYSTEM_FORCE_DELETE_ALL'); // deletes everything

    if (error) throw error;
    return true;
  } catch (err: any) {
    console.error('❌ Supabase TIMESHEET clear error:', err.message);
    return false;
  }
}

/**
 * Save calculated details into the requested "RateCalulate" table.
 * Helps preserve daily computed costs/OT in Supabase.
 */
export async function dbSaveRateCalculation(calcPayloads: any[]) {
  if (!calcPayloads || calcPayloads.length === 0) {
    return;
  }
  try {
    const tableName = await getTableRef('RateCalulate', ['ratecalulate', 'rate_calculate', 'RateCalculate']);
    const { error } = await supabase
      .from(tableName)
      .upsert(calcPayloads, { onConflict: 'ID' });

    if (error) {
      console.warn('⚠️ Supabase RateCalulate warning (ensure schema is loaded):', error.message);
    }
  } catch (err: any) {
    // Graceful warning
  }
}

/**
 * Save computed Payroll summary into "Sumary-Mount" (Summary Month)
 */
export async function dbSaveMonthlySummary(summaries: any[]) {
  if (!summaries || summaries.length === 0) {
    return;
  }
  try {
    const tableName = await getTableRef('Sumary-Mount', ['sumary_mount', 'SummaryMonth', 'summary_month']);
    const { error } = await supabase
      .from(tableName)
      .upsert(summaries, { onConflict: 'ID' });

    if (error) {
      console.warn('⚠️ Supabase Sumary-Mount warning (ensure schema is loaded):', error.message);
    }
  } catch (err: any) {
    // Graceful warning
  }
}

/**
 * Fetch individual supplements (Perdiem, Advance, Job Bonus, Remark) from Supabase.
 */
export async function dbFetchSupplements() {
  try {
    const tableName = await getTableRef('IndividualSupplements', ['individual_supplements', 'individualsupplements', 'IndividualSupplements', 'supplements', 'supplements_individual']);
    const { data, error } = await supabase
      .from(tableName)
      .select('*');

    if (error) {
      const errMsg = error.message || '';
      const isTableErr = errMsg.includes('Invalid path') || 
                         errMsg.toLowerCase().includes('not found') || 
                         errMsg.toLowerCase().includes('does not exist');
      if (isTableErr) {
        console.warn('⚠️ Supabase IndividualSupplements warning (schema not loaded or table not created yet):', errMsg);
      } else {
        console.error('❌ Supabase IndividualSupplements fetch error:', errMsg);
      }
      return null;
    }
    return data || [];
  } catch (err: any) {
    const errMsg = err?.message || '';
    if (errMsg.includes('Invalid path') || errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('does not exist')) {
      console.warn('⚠️ Supabase IndividualSupplements warning (schema not loaded or table not created yet):', errMsg);
    } else {
      console.error('❌ Supabase IndividualSupplements fetch error:', errMsg);
    }
    return null;
  }
}

/**
 * Save individual supplements directly to Supabase.
 */
export async function dbSaveSupplements(supplementsList: any[]) {
  if (!supplementsList || supplementsList.length === 0) {
    return true;
  }
  try {
    const tableName = await getTableRef('IndividualSupplements', ['individual_supplements', 'individualsupplements', 'IndividualSupplements', 'supplements', 'supplements_individual']);
    const { error } = await supabase
      .from(tableName)
      .upsert(supplementsList, { onConflict: 'ID' });

    if (error) {
      throw error;
    }
    return true;
  } catch (err: any) {
    const errMsg = err?.message || '';
    const isTableErr = errMsg.includes('Invalid path') || 
                       errMsg.toLowerCase().includes('not found') || 
                       errMsg.toLowerCase().includes('does not exist');
    if (isTableErr) {
      console.warn('⚠️ Supabase IndividualSupplements warning (schema not loaded or table not created yet):', errMsg);
    } else {
      console.error('❌ Supabase IndividualSupplements upsert error:', errMsg);
    }
    throw err;
  }
}

