import React, { useState, useMemo } from 'react';
import { Employee, TimesheetEntry, SystemSettings } from '../types';
import { 
  CreditCard, Download, Search, Settings, Calendar, 
  UserCheck, AlertCircle, FileText, CheckCircle2, 
  Printer, ArrowRight, Save, Coins, ShieldCheck
} from 'lucide-react';
import { supabase, dbSaveMonthlySummary, dbSaveRateCalculation } from '../lib/supabaseClient';

interface PayrollSectionProps {
  employees: Employee[];
  entries: TimesheetEntry[];
  settings: SystemSettings;
  isDark: boolean;
}

export default function PayrollSection({ employees, entries, settings, isDark }: PayrollSectionProps) {
  // Payroll cycle date default matching user standard: 2026-03-21 to 2026-04-20
  const [startDate, setStartDate] = useState<string>('2026-03-21');
  const [endDate, setEndDate] = useState<string>('2026-04-20');
  const [searchQuery, setSearchQuery] = useState('');

  // Editable other components per employee to prevent rigid states
  const [allowances, setAllowances] = useState<Record<string, number>>({});
  const [deductions, setDeductions] = useState<Record<string, number>>({});
  
  // Selected employee for the official Payslip Modal view
  const [selectedSlipEmpId, setSelectedSlipEmpId] = useState<string | null>(null);
  
  // Database status
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [subTab, setSubTab] = useState<'summaries' | 'details'>('summaries');

  // Filter entries to the selected period
  const periodEntries = useMemo(() => {
    return entries.filter(e => e.date && e.date >= startDate && e.date <= endDate);
  }, [entries, startDate, endDate]);

  // Compute calculated payroll for every employee
  const payrollDetails = useMemo(() => {
    return employees.map(emp => {
      // Find all timesheet records for this employee in the active period
      const empEntries = periodEntries.filter(
        entry => entry.employeeName.toLowerCase().trim() === emp.employeeName.toLowerCase().trim()
      );

      const daysWorked = empEntries.length;
      let totalHours = 0;
      let normalHoursCount = 0;
      let ot15HoursCount = 0;
      let ot20HoursCount = 0;
      let ot30HoursCount = 0;

      empEntries.forEach(ent => {
        const proj = (ent.project || '').toLowerCase();
        const isOffshore = proj.includes('offshore');
        normalHoursCount += ent.normalHours;
        
        // Zero out OT if project is Offshore
        const dOt15 = isOffshore ? 0 : ent.ot15Hours;
        const dOt20 = isOffshore ? 0 : ent.ot20Hours;
        const dOt30 = isOffshore ? 0 : ent.ot30Hours;

        ot15HoursCount += dOt15;
        ot20HoursCount += dOt20;
        ot30HoursCount += dOt30;
        totalHours += (ent.normalHours + dOt15 + dOt20 + dOt30);
      });

      // Income calculation formulas:
      let baseNormalPay = 0;
      let transportAllowanceTotal = 0;
      let ot15Pay = 0;
      let ot20Pay = 0;
      let ot30Pay = 0;
      let hourlyRate = 0;

      const isStaff = emp.workScheduleType === 'staff';

      if (isStaff) {
        // Staff has fixed base salary
        const salary = emp.officeSalary || emp.staffSalary || 0;
        baseNormalPay = salary;
        // Standard Thai Hourly Rate formula = (Staff Base Salary / 30 days / Default Work Hours)
        hourlyRate = Number((salary / 30 / settings.defaultWorkHours).toFixed(2));

        // Transportation allowance disabled for automatic calculation as requested ("ไม่ต้องใส่อัตโนมัติ")
        transportAllowanceTotal = 0;


        // OT Wages for staff, zeroing out any offshore project OT
        let runningOt15Pay = 0;
        let runningOt20Pay = 0;
        let runningOt30Pay = 0;

        empEntries.forEach(ent => {
          const proj = (ent.project || '').toLowerCase();
          const isOffshore = proj.includes('offshore');
          if (!isOffshore) {
            runningOt15Pay += ent.ot15Hours * hourlyRate * settings.ot15Rate;
            runningOt20Pay += ent.ot20Hours * hourlyRate * settings.ot20Rate;
            runningOt30Pay += ent.ot30Hours * hourlyRate * settings.ot30Rate;
          }
        });

        ot15Pay = runningOt15Pay;
        ot20Pay = runningOt20Pay;
        ot30Pay = runningOt30Pay;
      } else {
        // Daily Worker: Sum each day's base wage based on location/project AND calculate OT based on that day's rate
        let dailyWorkerSum = 0;
        let runningOt15Pay = 0;
        let runningOt20Pay = 0;
        let runningOt30Pay = 0;

        empEntries.forEach(ent => {
          let dayRate = emp.workshopRate || 0;
          const proj = (ent.project || '').toLowerCase();
          const isOffshore = proj.includes('offshore');
          
          if (proj.includes('onsite')) {
            dayRate = emp.onsiteRate || 0;
          } else if (isOffshore) {
            dayRate = emp.offshoreRate || 0;
          } else if (proj.includes('wfh') || proj.includes('home')) {
            dayRate = emp.wfhRate || 0;
          }

          dailyWorkerSum += dayRate;

          // If NOT offshore, calculate day-specific OT based on that day's rate
          if (!isOffshore) {
            const dayHourlyRate = Number((dayRate / settings.defaultWorkHours).toFixed(2));
            runningOt15Pay += ent.ot15Hours * dayHourlyRate * settings.ot15Rate;
            runningOt20Pay += ent.ot20Hours * dayHourlyRate * settings.ot20Rate;
            runningOt30Pay += ent.ot30Hours * dayHourlyRate * settings.ot30Rate;
          }
        });

        baseNormalPay = dailyWorkerSum;
        // Default standard hourly rate is (default workshopRate / Default Work Hours) for Daily workers (for display/metadata)
        hourlyRate = Number(((emp.workshopRate || settings.defaultDailyWage) / settings.defaultWorkHours).toFixed(2));

        // Transportation allowance disabled for automatic calculation as requested ("ไม่ต้องใส่อัตโนมัติ")
        transportAllowanceTotal = 0;

        // Assign the accumulated day-by-day OT pays
        ot15Pay = runningOt15Pay;
        ot20Pay = runningOt20Pay;
        ot30Pay = runningOt30Pay;
      }

      // Add user specified allowances
      const extraAllowance = allowances[emp.id] || 0;
      const otherDeduction = deductions[emp.id] || 0;

      // Withholding Tax & Social Security calculations (Thai Standards)
      const grossIncome = baseNormalPay + transportAllowanceTotal + ot15Pay + ot20Pay + ot30Pay + extraAllowance;
      
      // Thai SSO 2026 (ปี 2569) มาตรา 33: คิดเฉพาะเงินเดือน/ค่าแรงหลัก (ไม่รวม OT, ค่าพาหนะ, หรือเงินบวกเพิ่มอื่น ๆ)
      // - ต่ำกว่า 1,650 บาท: คิดจากฐานขั้นต่ำ 1,650 บาท (หัก 83 บาท)
      // - 1,650 - 17,500 บาท: หัก 5% ตามจริง
      // - เกิน 17,500 บาทขึ้นไป: คิดจากฐานเพดานสูงสุด 17,500 บาท (หักสูงสุด 875 บาท)
      let ssoDeduction = 0;
      const ssoBaseSalary = baseNormalPay;
      if (ssoBaseSalary > 0) {
        const adjustedBase = Math.max(1650, Math.min(17500, ssoBaseSalary));
        ssoDeduction = Math.round(adjustedBase * 0.05);
      }

      // Thai Withholding Tax: typically 3% for general contract daily wage, or scaled for staff
      // Estimated default: 3% of OT and daily pay, or 1.5% for general office
      const taxRate = emp.workScheduleType === 'staff' ? 0.015 : 0.03;
      const calculatedTax = Math.round(grossIncome * taxRate);

      // Student Loan (กยศ)
      const studentLoanDeduct = emp.studentLoan || 0;

      const totalDeductionVal = ssoDeduction + calculatedTax + studentLoanDeduct + otherDeduction;
      const netPayment = grossIncome - totalDeductionVal;

      return {
        id: emp.id,
        name: emp.employeeName,
        position: emp.position || 'พนักงาน',
        scheduleType: emp.workScheduleType === 'staff' ? 'รายเดือน' : 'รายวัน',
        daysWorked,
        totalHours: Number(totalHours.toFixed(2)),
        normalHours: Number(normalHoursCount.toFixed(2)),
        ot15Hours: Number(ot15HoursCount.toFixed(2)),
        ot20Hours: Number(ot20HoursCount.toFixed(2)),
        ot30Hours: Number(ot30HoursCount.toFixed(2)),
        hourlyRate,
        baseNormalPay: Number(baseNormalPay.toFixed(2)),
        transportAllowance: Number(transportAllowanceTotal.toFixed(2)),
        ot15Wage: Number(ot15Pay.toFixed(2)),
        ot20Wage: Number(ot20Pay.toFixed(2)),
        ot30Wage: Number(ot30Pay.toFixed(2)),
        extraAllowance,
        otherDeduction,
        sso: ssoDeduction,
        tax: calculatedTax,
        studentLoan: studentLoanDeduct,
        totalIncome: Number(grossIncome.toFixed(2)),
        totalDeductions: Number(totalDeductionVal.toFixed(2)),
        netIncome: Number(netPayment.toFixed(2)),
        bankName: emp.bankName || 'ธนาคารทั่วไป',
        bankAccount: emp.bankAccount || 'xxx-xxx-xxxx'
      };
    });
  }, [employees, periodEntries, allowances, deductions, settings]);

  // Overall sums to show in top summary rows
  const totals = useMemo(() => {
    let grandNormalPay = 0;
    let grandOT15 = 0;
    let grandOT20 = 0;
    let grandOT30 = 0;
    let grandAllowance = 0;
    let grandTax = 0;
    let grandSSO = 0;
    let grandStudentLoan = 0;
    let grandGross = 0;
    let grandNet = 0;

    payrollDetails.forEach(p => {
      grandNormalPay += p.baseNormalPay;
      grandOT15 += p.ot15Wage;
      grandOT20 += p.ot20Wage;
      grandOT30 += p.ot30Wage;
      grandAllowance += (p.transportAllowance + p.extraAllowance);
      grandTax += p.tax;
      grandSSO += p.sso;
      grandStudentLoan += p.studentLoan;
      grandGross += p.totalIncome;
      grandNet += p.netIncome;
    });

    return {
      normalPay: Number(grandNormalPay.toFixed(2)),
      ot15: Number(grandOT15.toFixed(2)),
      ot20: Number(grandOT20.toFixed(2)),
      ot30: Number(grandOT30.toFixed(2)),
      allowance: Number(grandAllowance.toFixed(2)),
      tax: Math.round(grandTax),
      sso: Math.round(grandSSO),
      studentLoan: Math.round(grandStudentLoan),
      gross: Number(grandGross.toFixed(2)),
      net: Number(grandNet.toFixed(2))
    };
  }, [payrollDetails]);

  // Handle Search Filtering
  const filteredPayroll = useMemo(() => {
    return payrollDetails.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.id.toLowerCase().includes(searchQuery.toLowerCase());
      // Show profiles that have work days or search results
      if (searchQuery) return matchSearch;
      return p.daysWorked > 0 || p.totalIncome > 0;
    });
  }, [payrollDetails, searchQuery]);

  // Compute day-by-day earnings details for the selected period
  const dailyEarningsBreakdown = useMemo(() => {
    const list: any[] = [];
    periodEntries.forEach(ent => {
      const emp = employees.find(e => e.employeeName.toLowerCase().trim() === ent.employeeName.toLowerCase().trim());
      if (!emp) return;

      // Base rate determination
      let baseRate = emp.workshopRate || 0;
      const proj = (ent.project || '').toLowerCase();
      const isOffshore = proj.includes('offshore');
      if (proj.includes('onsite')) {
        baseRate = emp.onsiteRate || 0;
      } else if (isOffshore) {
        baseRate = emp.offshoreRate || 0;
      } else if (proj.includes('wfh') || proj.includes('home')) {
        baseRate = emp.wfhRate || 0;
      }

      // Compute standard hourly rate
      const hourlyBase = Number((baseRate / settings.defaultWorkHours).toFixed(2));
      
      // Calculate daily OT cash
      // Offshore projects have absolutely zero OT
      const otEarnings = isOffshore ? 0 : 
                         ((ent.ot15Hours * hourlyBase * settings.ot15Rate) + 
                          (ent.ot20Hours * hourlyBase * settings.ot20Rate) + 
                          (ent.ot30Hours * hourlyBase * settings.ot30Rate));
      const dayTotal = baseRate + otEarnings;

      list.push({
        id: ent.id,
        employeeName: ent.employeeName,
        employeeId: emp.id,
        date: ent.date,
        project: ent.project || 'workshop',
        rate: baseRate,
        lunchOT: ent.lunchOT ? 1 : 0,
        normalHours: ent.normalHours,
        ot15Hours: isOffshore ? 0 : ent.ot15Hours,
        ot20Hours: isOffshore ? 0 : ent.ot20Hours,
        ot30Hours: isOffshore ? 0 : ent.ot30Hours,
        remark: ent.remark || '',
        otEarnings,
        dayTotal
      });
    });

    // Sort by date then employeeName
    return list.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.employeeName.localeCompare(b.employeeName);
    });
  }, [periodEntries, employees, settings]);

  // Filter daily earnings list by search query
  const filteredDailyEarnings = useMemo(() => {
    return dailyEarningsBreakdown.filter(d => {
      const matchSearch = d.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          d.employeeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          d.project.toLowerCase().includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [dailyEarningsBreakdown, searchQuery]);

  // Find the selected employee's payroll details to show on the payslip modal
  const activeSlip = useMemo(() => {
    if (!selectedSlipEmpId) return null;
    return payrollDetails.find(p => p.id === selectedSlipEmpId) || null;
  }, [payrollDetails, selectedSlipEmpId]);

  // Synchronize the current payroll cycle with Supabase (Sumary-Mount & RateCalulate tables)
  const handleSyncToSupabase = async () => {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      // 1. Prepare monthly summaries for 'Sumary-Mount'
      const summaryPayloads = payrollDetails
        .filter(p => p.daysWorked > 0)
        .map(p => {
          // Construct deterministic sync ID to prevent duplicate listings on same cycle
          const hashId = `${p.id}-${startDate}-${endDate}`;
          return {
            EmployeeName: p.name,
            StartDate: startDate,
            EndDate: endDate,
            TotalTime: p.totalHours,
            TotalDays: p.daysWorked,
            NetNormal: p.baseNormalPay,
            OT15Wage: p.ot15Wage,
            OT20Wage: p.ot20Wage,
            OT30Wage: p.ot30Wage,
            OtherIncome: p.transportAllowance + p.extraAllowance,
            OtherDeductions: p.otherDeduction,
            TaxDeduct: p.tax,
            SocialSecurity: p.sso,
            StudentLoan: p.studentLoan,
            TotalIncome: p.totalIncome,
            NetIncome: p.netIncome
          };
        });

      // 2. Prepare detailed daily rates calculations payload for 'RateCalulate'
      const ratePayloads: any[] = [];
      periodEntries.forEach(ent => {
        const emp = employees.find(e => e.employeeName.toLowerCase().trim() === ent.employeeName.toLowerCase().trim());
        if (!emp) return;

        // Base rate determination
        let baseRate = emp.workshopRate || 0;
        const proj = (ent.project || '').toLowerCase();
        if (proj.includes('onsite')) baseRate = emp.onsiteRate || 0;
        else if (proj.includes('offshore')) baseRate = emp.offshoreRate || 0;
        else if (proj.includes('wfh')) baseRate = emp.wfhRate || 0;

        const hourlyBase = Number((baseRate / settings.defaultWorkHours).toFixed(2));
        const otEarnings = (ent.ot15Hours * hourlyBase * settings.ot15Rate) + (ent.ot20Hours * hourlyBase * settings.ot20Rate) + (ent.ot30Hours * hourlyBase * settings.ot30Rate);
        const dayTotal = baseRate + otEarnings;

        ratePayloads.push({
          EmployeeName: ent.employeeName,
          Date: ent.date,
          Project: ent.project || 'workshop',
          RATE: baseRate,
          LunchOT: ent.lunchOT ? 1 : 0,
          NormalHours: ent.normalHours,
          OT15Hours: ent.ot15Hours,
          OT20Hours: ent.ot20Hours,
          OT30Hours: ent.ot30Hours,
          Remark: ent.remark || '',
          OTCalculated: otEarnings,
          Sumtotal: dayTotal
        });
      });

      // Execute bulk Supabase inserts
      if (summaryPayloads.length > 0) {
        await dbSaveMonthlySummary(summaryPayloads);
      }
      if (ratePayloads.length > 0) {
        await dbSaveRateCalculation(ratePayloads);
      }

      setSaveStatus({
        type: 'success',
        text: '🎉 อัปโหลดและบันทึกประวัติการคำนวณเบิกจ่ายเข้า Supabase สำเร็จหมดจดแล้ว!'
      });
    } catch (err: any) {
      setSaveStatus({
        type: 'error',
        text: `❌ ไม่สามารถบันทึกข้อมูลได้: ${err.message || 'โปรดตรวจสอบตารางและสิทธิ์เข้าถึง'}`
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Convert numbers to Thai text for Payslips
  const thaiBahtText = (num: number): string => {
    // Basic fallback or clean visual design, can write a simple converter or display formatted numeral
    return num.toLocaleString('th-TH', { style: 'currency', currency: 'THB' }) + ' บาทถ้วน';
  };

  // Dynamic eye-friendly color themes based on isDark prop
  const cardBgStyle = isDark ? 'bg-[#141414] border border-white/10' : 'bg-white border border-slate-205 shadow-xs text-slate-800';
  const textMutedStyle = isDark ? 'text-gray-400' : 'text-slate-550 font-medium';
  const textTitleStyle = isDark ? 'text-white' : 'text-slate-800 font-bold';
  const inputBgStyle = isDark ? 'bg-[#0D0D0D] border-white/10 text-white focus:border-[#D4AF37]' : 'bg-slate-50 border-slate-200 text-slate-800 focus:bg-white focus:border-amber-600';
  const kpiBgStyle = isDark ? 'bg-[#141414] border border-white/10' : 'bg-white border border-slate-205 shadow-xs text-slate-800';
  const tableThStyle = isDark ? 'bg-[#0D0D0D] text-gray-400 border-b border-white/10' : 'bg-[#f8f9fa] text-slate-600 border-b border-slate-200';
  const tableTrStyle = isDark ? 'hover:bg-white/[0.01] border-b border-white/5 text-gray-300' : 'hover:bg-slate-50 border-b border-slate-100 text-slate-700';

  return (
    <div className="space-y-6 text-left">
      {/* Date controls and parameters */}
      <div className={`${cardBgStyle} p-5 rounded-sm`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-serif uppercase tracking-wider text-amber-600 dark:text-[#D4AF37] flex items-center gap-2 font-bold">
              <Coins className="w-5 h-5" />
              หน้าคำนวณเงินเดือน & ออกสลิปราชการ (Thai Payroll & Salary slip Workspace)
            </h2>
            <p className={`text-xs ${textMutedStyle} mt-1`}>
              คำนวณค่าตอบแทนฐานปกติ (Staff/Daily) และยอดสะสมโอทีแบบเรียลไทม์ พร้อมปรับเพิ่มเงินได้ตามรอบอย่างง่ายดาย
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSyncToSupabase}
              disabled={isSaving || filteredPayroll.length === 0}
              className="py-2 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-sm text-xs font-bold font-sans flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'กำลังบันทึก...' : 'ซิงค์ประวัติเข้า Supabase'}
            </button>
          </div>
        </div>
        {/* Date Filters Grid */}
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 pt-5 border-t ${isDark ? 'border-white/10' : 'border-slate-205'}`}>
          <div className="space-y-1.5 text-left">
            <label className="text-[10px] font-bold text-amber-600 dark:text-[#D4AF37] uppercase tracking-wider block">วันเริ่มต้นรอบจ่าย (Start Cutoff)</label>
            <input
              id="payroll-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`w-full text-xs rounded-sm py-2 px-3 focus:outline-hidden ${inputBgStyle}`}
            />
          </div>

          <div className="space-y-1.5 text-left">
            <label className="text-[10px] font-bold text-amber-600 dark:text-[#D4AF37] uppercase tracking-wider block">วันสิ้นสุดรอบจ่าย (End Cutoff)</label>
            <input
              id="payroll-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`w-full text-xs rounded-sm py-2 px-3 focus:outline-hidden ${inputBgStyle}`}
            />
          </div>

          <div className="space-y-1.5 flex flex-col justify-end text-left">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="search-payroll-emp"
                type="text"
                placeholder="ค้นพนักงานด้วยชื่อ หรือรหัส..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full text-xs pl-9 pr-3 py-2 rounded-sm focus:outline-hidden ${inputBgStyle}`}
              />
            </div>
          </div>
        </div>
        {saveStatus && (
          <div className={`mt-4 p-3 rounded-sm text-xs flex items-center gap-2 border ${
            saveStatus.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/30' 
              : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/45 dark:text-red-350 dark:border-red-900/30'
          }`}>
            <AlertCircle className="w-4 h-4 text-emerald-500" />
            {saveStatus.text}
          </div>
        )}
      </div>

      {/* Payroll KPI Cards Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={`${kpiBgStyle} p-4 rounded-sm flex items-center gap-4 text-left`}>
          <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${isDark ? 'bg-[#0D0D0D] border border-white/5' : 'bg-sky-50'}`}>
            <FileText className="w-5 h-5 text-sky-500" />
          </div>
          <div>
            <div className={`text-[10px] ${textMutedStyle} uppercase tracking-widest font-sans font-bold`}>ยอดจ่ายแรงหนุนสะสม</div>
            <div className="text-base font-extrabold text-[#0284c7] dark:text-[#38BDF8] mt-0.5">{totals.normalPay.toLocaleString()} ฿</div>
            <div className="text-[9px] text-gray-400 font-mono">เงินเดือน Fixed / ค่าแรงปกติสะสม</div>
          </div>
        </div>

        <div className={`${kpiBgStyle} p-4 rounded-sm flex items-center gap-4 text-left`}>
          <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${isDark ? 'bg-[#0D0D0D] border border-white/5' : 'bg-amber-50'}`}>
            <Coins className="w-5 h-5 text-amber-550 dark:text-[#D4AF37]" />
          </div>
          <div>
            <div className={`text-[10px] ${textMutedStyle} uppercase tracking-widest font-sans font-bold`}>ยอดเบิกจ่ายโอทีรวม (OT)</div>
            <div className="text-base font-extrabold text-amber-600 dark:text-[#D4AF37] mt-0.5">{(totals.ot15 + totals.ot20 + totals.ot30).toLocaleString()} ฿</div>
            <div className="text-[9px] text-gray-400 font-mono">สะสมโอทีเรท 1.5 / 2.0 / 3.0</div>
          </div>
        </div>

        <div className={`${kpiBgStyle} p-4 rounded-sm flex items-center gap-4 text-left`}>
          <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${isDark ? 'bg-[#0D0D0D] border border-white/5' : 'bg-purple-50'}`}>
            <ShieldCheck className="w-5 h-5 text-purple-550 dark:text-purple-450" />
          </div>
          <div>
            <div className={`text-[10px] ${textMutedStyle} uppercase tracking-widest font-sans font-bold`}>ประกันสังคม + ภาษีรวม</div>
            <div className="text-base font-extrabold text-slate-750 dark:text-gray-300 mt-0.5">{(totals.sso + totals.tax).toLocaleString()} ฿</div>
            <div className="text-[9px] text-gray-400 font-mono">หักรัฐบาล (SSO ประกันฯ ปี 2569)</div>
          </div>
        </div>

        <div className={`${kpiBgStyle} p-4 rounded-sm flex items-center gap-4 text-left ${isDark ? 'bg-gradient-to-tr from-amber-500/5 to-transparent' : 'bg-[#e6f4ea]/30 border-emerald-100/70'}`}>
          <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${isDark ? 'bg-[#0D0D0D] border border-[#ffffff0a]' : 'bg-emerald-150'}`}>
            <UserCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <div className={`text-[10px] uppercase tracking-widest font-sans font-bold text-[#10b981] dark:text-[#34d399]`}>ยอดจ่ายสุทธิรวมทั้งหมด</div>
            <div className="text-lg font-black text-[#10b981] dark:text-[#34d399] mt-0.5">{totals.net.toLocaleString()} ฿</div>
            <div className="text-[9px] text-gray-400 font-mono">หักลบครบถ้วนแล้ว ณ สิ้นเดือน</div>
          </div>
        </div>
      </div>

      {/* Sub-tab selection menu */}
      <div className="flex border-b border-slate-200 dark:border-white/10 mt-2">
        <button
          onClick={() => setSubTab('summaries')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-wider relative cursor-pointer border-b-2 transition-all ${
            subTab === 'summaries'
              ? 'border-[#D4AF37] text-amber-600 dark:text-[#D4AF37]'
              : isDark ? 'border-transparent text-gray-400 hover:text-white' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          สรุปเงินเดือน & สลิปเงินเดือน (Monthly Summaries & Slips)
        </button>
        <button
          onClick={() => setSubTab('details')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-wider relative cursor-pointer border-b-2 transition-all ${
            subTab === 'details'
              ? 'border-[#D4AF37] text-amber-600 dark:text-[#D4AF37]'
              : isDark ? 'border-transparent text-gray-400 hover:text-white' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          บัญชีรายได้แยกรายวันพนักงานทุกคน (Detailed Daily Earnings Breakdown)
        </button>
      </div>

      {subTab === 'summaries' ? (
        <div className={`${cardBgStyle} overflow-hidden text-left`}>
          <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-slate-205 bg-[#f8f9fa]'}`}>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-653 dark:text-[#D4AF37] font-sans">สรุปแผ่นจ่ายเงินเดือนและโอทีระดับบุคคล (Payroll Core Matrix)</h3>
              <p className={`text-[10.5px] ${textMutedStyle} mt-0.5 font-medium`}>
                ประกอบด้วยข้อมูลวันเข้ากะคำนวณเบิก และช่องปรับแต่งอื่นเพิ่มรายจ่าย-รายรับ ชั่วคราวรายจ่ายเฉพาะบุคคล
              </p>
            </div>
          </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`${tableThStyle} uppercase font-semibold text-[9px] tracking-widest`}>
              <tr>
                <th className="py-2.5 px-3 font-bold">รหัสกพ.</th>
                <th className="py-2.5 px-3 text-amber-653 dark:text-[#D4AF37] font-bold">ชื่อพนักงาน</th>
                <th className="py-2.5 px-3 font-bold">ประเภทจ้าง</th>
                <th className="py-2.5 px-3 text-center font-bold">วันทำ</th>
                <th className="py-2.5 px-3 text-right text-slate-800 dark:text-gray-300 font-bold">ค่าจ้างมูลฐาน</th>
                <th className="py-2.5 px-3 text-right text-amber-653 dark:text-[#D4AF37] font-bold">ยอดสะสม OT</th>
                <th className="py-2.5 px-3 text-center font-bold text-amber-600 dark:text-amber-400">Other Income (กรอกเอง)</th>
                <th className="py-2.5 px-3 text-center font-bold text-red-500">Deduction (กรอกเอง)</th>
                <th className="py-2.5 px-3 text-right text-red-650 dark:text-red-400 font-bold">หักภาษี 3%</th>
                <th className="py-2.5 px-3 text-right text-red-650 dark:text-red-400 font-bold">หักประกันสังคม (2569)</th>
                <th className="py-2.5 px-3 text-right text-purple-650 dark:text-purple-400 font-bold">หัก กยศ.</th>
                <th className="py-2.5 px-3 text-right font-extrabold text-emerald-600 dark:text-emerald-450 font-bold">รายรับสุทธิ</th>
                <th className="py-2.5 px-3 w-16 text-center text-gray-500 font-bold">ออกสลิป</th>
              </tr>
            </thead>

            <tbody className={`divide-y font-medium ${isDark ? 'divide-white/5 bg-[#141414]' : 'divide-slate-100 bg-white'}`}>
              {filteredPayroll.length > 0 ? (
                filteredPayroll.map((p, idx) => (
                  <tr key={idx} className={`${tableTrStyle} transition-colors text-[11px]`}>
                    <td className="py-2 px-3 font-mono text-gray-500">{p.id}</td>
                    <td className={`py-2 px-3 font-bold ${isDark ? 'text-white' : 'text-slate-800'}`}>{p.name}</td>
                    <td className="py-2 px-3 text-left">
                      <span className={`px-1.5 py-0.5 rounded-sm text-[8px] font-bold inline-block ${
                        p.scheduleType === 'รายเดือน' 
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/45 dark:text-blue-300 border border-blue-200 dark:border-blue-900/30' 
                          : 'bg-indigo-100 text-indigo-705 dark:bg-indigo-950/45 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/30'
                      }`}>
                        {p.scheduleType}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center font-mono">{p.daysWorked} วัน</td>
                    <td className="py-2 px-3 text-right font-mono text-gray-605 dark:text-gray-300">{p.baseNormalPay.toLocaleString()}</td>
                    
                    {/* Accumulated OT */}
                    <td className="py-2 px-3 text-right font-mono text-amber-653 dark:text-[#D4AF37]">
                      {(p.ot15Wage + p.ot20Wage + p.ot30Wage).toLocaleString()}
                    </td>

                    {/* Other Income (กรอกเอง) */}
                    <td className="py-2 px-3 text-center">
                      <input
                        type="number"
                        placeholder="0"
                        value={allowances[p.id] !== undefined ? allowances[p.id] : ''}
                        onChange={(e) => setAllowances({ ...allowances, [p.id]: parseFloat(e.target.value) || 0 })}
                        className={`w-20 text-[11px] px-1.5 py-1 text-right bg-transparent border rounded-sm focus:outline-hidden ${isDark ? 'border-white/10 text-amber-400 focus:border-[#D4AF37]' : 'border-slate-300 text-amber-700 font-bold focus:border-amber-600'}`}
                      />
                    </td>

                    {/* Deduction (Other Deduction กรอกเอง) */}
                    <td className="py-2 px-3 text-center">
                      <input
                        type="number"
                        placeholder="0"
                        value={deductions[p.id] !== undefined ? deductions[p.id] : ''}
                        onChange={(e) => setDeductions({ ...deductions, [p.id]: parseFloat(e.target.value) || 0 })}
                        className={`w-20 text-[11px] px-1.5 py-1 text-right bg-transparent border rounded-sm focus:outline-hidden ${isDark ? 'border-white/10 text-red-450 focus:border-red-500' : 'border-slate-300 text-red-600 font-bold focus:border-red-500'}`}
                      />
                    </td>

                    {/* Deductions: tax */}
                    <td className="py-2 px-3 text-right font-mono text-red-500 dark:text-red-400">
                      {p.tax.toLocaleString()}
                    </td>

                    {/* Deductions: SSO */}
                    <td className="py-2 px-3 text-right font-mono text-red-555 dark:text-red-350">
                      {p.sso}
                    </td>

                    {/* Student Loan */}
                    <td className="py-2 px-3 text-right font-mono text-purple-600 dark:text-purple-305">
                      {p.studentLoan > 0 ? (
                        <span title="หัก กยศ. ตามไฟล์ประวัติ">{p.studentLoan}</span>
                      ) : '—'}
                    </td>


                    {/* Net payout */}
                    <td className={`py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 ${isDark ? 'bg-white/[0.01]' : 'bg-slate-50/20'}`}>
                      {p.netIncome.toLocaleString()} ฿
                    </td>

                    {/* Slip generation button */}
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => setSelectedSlipEmpId(p.id)}
                        className="p-1 px-1.5 bg-[#D4AF37] hover:bg-amber-400 text-black text-[10px] font-sans font-bold flex items-center gap-1 mx-auto rounded-sm cursor-pointer shadow-xs whitespace-nowrap"
                      >
                        <FileText className="w-3 h-3" />
                        Slip/ใบจ่าย
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className="text-center py-6 text-gray-500">
                    ไม่พบข้อมูลผู้ปฏิบัติงานมียอดจัดรอบ หรือข้อมูลประวัติ ณ ขณะนี้
                  </td>
                </tr>
              )}
            </tbody>
            {filteredPayroll.length > 0 && (
              <tfoot className={`font-bold text-[10px] uppercase font-mono border-t ${isDark ? 'bg-[#0D0D0D] text-gray-300 border-white/10' : 'bg-[#f8f9fa] text-slate-700 border-slate-200'}`}>
                <tr>
                  <td colSpan={4} className="py-2.5 px-3 text-right text-gray-500 font-bold">ยอดเงินรวมทั้งสิ้นรอบจ่าย (Totals):</td>
                  <td className="py-2.5 px-3 text-right text-slate-800 dark:text-gray-100">{totals.normalPay.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-amber-653 dark:text-[#D4AF37]">{(totals.ot15 + totals.ot20 + totals.ot30).toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-slate-705 dark:text-gray-305">{totals.allowance.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-red-500 dark:text-red-400">{totals.tax.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-red-500 dark:text-red-400">{totals.sso.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right text-purple-600 dark:text-purple-400">{totals.studentLoan.toLocaleString()}</td>
                  <td className={`py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 ${isDark ? 'bg-white/5' : 'bg-emerald-50'}`}>{totals.net.toLocaleString()} ฿</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      ) : (
        /* Detailed Daily Earnings view */
        <div className={`${cardBgStyle} overflow-hidden text-left`}>
          <div className={`p-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-4 ${isDark ? 'border-white/10' : 'border-slate-205 bg-[#f8f9fa]'}`}>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#D4AF37] font-sans">แผ่นบัญชีกระจายรายรับรายวัน (Daily Earnings Sheet Analyzer)</h3>
              <p className={`text-[10.5px] ${textMutedStyle} mt-0.5 font-medium`}>
                ตรวจสอบรายละเอียดรายวัน อัตราพื้นฐานตามสถานที่ปฏิบัติงาน และโอทีแต่ละวันของกำลังพลทุกคน
              </p>
            </div>
            {filteredDailyEarnings.length > 0 && (
              <button
                onClick={() => {
                  const headers = [
                    'วันที่',
                    'รหัสพนักงาน',
                    'ชื่อพนักงาน',
                    'โครงการ/ไซส์งาน',
                    'อัตราจ้างวันนั้น',
                    'ชั่วโมงปกติ',
                    'OT 1.5 (ชม.)',
                    'OT 2.0 (ชม.)',
                    'OT 3.0 (ชม.)',
                    'เงินโอทีวันนี้',
                    'รวมรายได้วันนี้'
                  ];
                  const rows = filteredDailyEarnings.map(d => [
                    d.date,
                    d.employeeId,
                    d.employeeName,
                    `"${d.project}"`,
                    d.rate,
                    d.normalHours,
                    d.ot15Hours,
                    d.ot20Hours,
                    d.ot30Hours,
                    d.otEarnings.toFixed(2),
                    d.dayTotal.toFixed(2)
                  ]);
                  const csvContent = "\uFEFF" + [
                    `แผ่นบัญชีกระจายรายรับรายวันช่วงวันที่ ${startDate} ถึง ${endDate}`,
                    headers.join(','),
                    ...rows.map(r => r.join(','))
                  ].join('\n');
                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.setAttribute('href', url);
                  link.setAttribute('download', `Daily_Earnings_Report_${startDate}_to_${endDate}.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="py-1 px-3 bg-[#D4AF37] hover:bg-amber-400 text-black rounded-sm text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap self-start md:self-auto"
              >
                <Download className="w-3.5 h-3.5" />
                ส่งออกรายงานรายวัน CSV
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-850 dark:text-gray-300">
              <thead className={`${tableThStyle} uppercase font-semibold text-[9px] tracking-widest`}>
                <tr>
                  <th className="py-2.5 px-3 font-bold">วันที่</th>
                  <th className="py-2.5 px-3 font-bold">รหัส</th>
                  <th className="py-2.5 px-3 text-amber-653 dark:text-[#D4AF37] font-bold">ชื่อพนักงาน</th>
                  <th className="py-2.5 px-3 font-bold">โครงการ/ไซส์งาน</th>
                  <th className="py-2.5 px-3 text-right font-bold">อัตรากักจ้าง</th>
                  <th className="py-2.5 px-3 text-center font-bold">เวลาทำ</th>
                  <th className="py-2.5 px-3 text-center font-bold">ชั่วโมงปกติ / OT</th>
                  <th className="py-2.5 px-3 text-right text-amber-600 dark:text-[#D4AF37] font-bold">ยอดโอทีสะสม</th>
                  <th className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-extrabold">รวมรายได้ประเมิน</th>
                  <th className="py-2.5 px-3 font-bold">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className={`divide-y font-medium ${isDark ? 'divide-white/5 bg-[#141414]' : 'divide-slate-100 bg-white'}`}>
                {filteredDailyEarnings.length > 0 ? (
                  filteredDailyEarnings.map((d, idx) => (
                    <tr key={idx} className={`${tableTrStyle} transition-colors text-[11px]`}>
                      <td className="py-2 px-3 font-mono text-gray-500 whitespace-nowrap">{d.date}</td>
                      <td className="py-2 px-3 font-mono text-gray-500">{d.employeeId}</td>
                      <td className={`py-2 px-3 font-bold ${isDark ? 'text-white' : 'text-slate-850'}`}>{d.employeeName}</td>
                      <td className="py-2 px-3 font-bold">
                        <span className="font-mono bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-450 px-1.5 py-0.5 rounded text-[10px]">
                          {d.project}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {d.rate.toLocaleString()} ฿
                      </td>
                      <td className="py-2 px-3 text-center text-gray-400 font-mono text-[9px] whitespace-nowrap">
                        {d.timeIn && d.timeOut ? `${d.timeIn} - ${d.timeOut}` : '—'}
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-[10px]">
                        <span className="text-gray-500">{d.normalHours} ชม.</span>
                        { (d.ot15Hours > 0 || d.ot20Hours > 0 || d.ot30Hours > 0) && (
                          <span className="text-amber-500 ml-1.5" title={`OT1.5: ${d.ot15Hours} | OT2.0: ${d.ot20Hours} | OT3.0: ${d.ot30Hours}`}>
                            (OT: {(d.ot15Hours + d.ot20Hours + d.ot30Hours).toFixed(1)} ชม.)
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-amber-653 dark:text-[#D4AF37]">
                        {d.otEarnings > 0 ? `${d.otEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {d.dayTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
                      </td>
                      <td className="py-2 px-3 text-gray-400 max-w-xs truncate" title={d.remark}>{d.remark || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="text-center py-6 text-gray-500">
                      ไม่พบข้อมูลรายงานรายวันสะสมประจำรอบนี้
                    </td>
                  </tr>
                )}
              </tbody>
              {filteredDailyEarnings.length > 0 && (
                <tfoot className={`font-bold text-[10px] uppercase font-mono border-t ${isDark ? 'bg-[#0D0D0D] text-gray-300 border-white/10' : 'bg-[#f8f9fa] text-slate-700 border-slate-200'}`}>
                  <tr>
                    <td colSpan={4} className="py-2.5 px-3 text-right text-gray-500 font-bold">ผลรวมรายรับทั้งหมดประจำรอบ (Total):</td>
                    <td className="py-2.5 px-3 text-right text-slate-800 dark:text-gray-100">
                      {filteredDailyEarnings.reduce((acc, curr) => acc + curr.rate, 0).toLocaleString()} ฿
                    </td>
                    <td></td>
                    <td></td>
                    <td className="py-2.5 px-3 text-right text-amber-653 dark:text-[#D4AF37]">
                      {filteredDailyEarnings.reduce((acc, curr) => acc + curr.otEarnings, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
                    </td>
                    <td className={`py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 ${isDark ? 'bg-white/5' : 'bg-emerald-50'}`}>
                      {filteredDailyEarnings.reduce((acc, curr) => acc + curr.dayTotal, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* SLIP MODAL DIALOG PREVIEW CONTAINER */}
      {activeSlip && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#141414] border border-white/20 rounded max-w-2xl w-full p-6 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            {/* Header controls for Modal */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-xs font-bold text-[#D4AF37] uppercase flex items-center gap-1.5 font-serif">
                <FileText className="w-4 h-4 text-[#D4AF37]" />
                สลิปยอดเงินเดี่ยวราชการ / ประกันสังคม บริษัทจำกัด (PREVIEW & PRINT)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="p-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-bold flex items-center gap-1"
                >
                  <Printer className="w-3.5 h-3.5" />
                  พิมพ์สลิป/PDF
                </button>
                <button
                  onClick={() => setSelectedSlipEmpId(null)}
                  className="p-1 text-gray-400 hover:text-white"
                >
                  ปิดหน้านี้
                </button>
              </div>
            </div>

            {/* Official Print Layout Frame */}
            <div className="bg-white text-black p-6 rounded-xs shadow-sm font-sans space-y-6 border border-gray-300 print:p-0 print:border-0" id="thai-ot-slip-printable-area">
              
              {/* Slip Header banner */}
              <div className="text-center space-y-1 pb-4 border-b-2 border-black">
                <h4 className="text-base font-serif uppercase tracking-widest font-extrabold">ใบแจ้งยอดเงินเดือนและค่าตอบแทนทำงานวิชาชีพ</h4>
                <p className="text-[11px] text-gray-600 font-bold uppercase tracking-wide">IKM TESTING (THAILAND) CO., LTD.</p>
                <p className="text-[10px] text-gray-500 font-medium font-mono">
                  รอบประมวลตัดรอบจ่ายประจำช่วงวันที่: <span className="font-bold underline text-black">{startDate}</span> ถึงวันที่ <span className="font-bold underline text-black">{endDate}</span>
                </p>
              </div>

              {/* Employee metadata details info panel */}
              <div className="grid grid-cols-2 gap-y-1.5 text-xs pb-4 border-b border-gray-300 font-mono">
                <div>รหัสผู้บันทึก: <strong className="font-sans text-[12.5px]">{activeSlip.id}</strong></div>
                <div>ชื่อนามสกุลพนักงาน: <strong className="font-sans text-[12.5px]">{activeSlip.name}</strong></div>
                <div>ตำแหน่งงาน: <strong className="font-sans">{activeSlip.position}</strong></div>
                <div>ประเภทสัญญาจ้าง: <strong className="font-sans">{activeSlip.scheduleType}</strong></div>
                <div>เลขบัญชีโอนรับเงิน: <strong className="font-sans">{activeSlip.bankName} - {activeSlip.bankAccount}</strong></div>
                <div>วันลงเวลารอบทำ: <strong className="font-sans">{activeSlip.daysWorked} วันปฏิบัติงาน</strong></div>
              </div>

              {/* Two columns: Earnings & Deductions matching standard payslip template */}
              <div className="grid grid-cols-2 border-r border-t border-b border-gray-400 text-xs">
                {/* Earnings List COLUMN */}
                <div className="border-l border-[#000] divide-y divide-gray-300">
                  <div className="bg-gray-100 p-1.5 font-bold text-center border-b border-gray-400">รายการรายรับได้รับ (Earnings)</div>
                  <div className="p-1 px-3 flex justify-between">
                    <span>เงินค่าจ้างมูลฐานสะสม</span>
                    <strong>{activeSlip.baseNormalPay.toLocaleString()}</strong>
                  </div>
                  <div className="p-1 px-3 flex justify-between">
                    <span>ค่าล่วงเวลาสะสม (OT 1.5)</span>
                    <strong>{activeSlip.ot15Wage.toLocaleString()}</strong>
                  </div>
                  <div className="p-1 px-3 flex justify-between">
                    <span>ค่าทำงานเสาร์/วันหยุด (OT 2.0)</span>
                    <strong>{activeSlip.ot20Wage.toLocaleString()}</strong>
                  </div>
                  <div className="p-1 px-3 flex justify-between">
                    <span>ค่าล่วงเวลาลากหยุด (OT 3.0)</span>
                    <strong>{activeSlip.ot30Wage.toLocaleString()}</strong>
                  </div>
                  {activeSlip.transportAllowance > 0 && (
                    <div className="p-1 px-3 flex justify-between">
                      <span>ค่าเดินทาง / รถส่วนบุคคล</span>
                      <strong>{activeSlip.transportAllowance.toLocaleString()}</strong>
                    </div>
                  )}
                  <div className="p-1 px-3 flex justify-between bg-amber-50/50">
                    <span>รายรับอื่น / Other Income</span>
                    <strong>{activeSlip.extraAllowance.toLocaleString()}</strong>
                  </div>

                  <div className="p-1.5 bg-gray-150 text-right font-extrabold border-t border-gray-450 flex justify-between">
                    <span>รายได้รวม (Gross)</span>
                    <span>{activeSlip.totalIncome.toLocaleString()} ฿</span>
                  </div>
                </div>

                {/* Deductions COLUMN */}
                <div className="border-l border-r border-[#000] divide-y divide-gray-300">
                  <div className="bg-gray-100 p-1.5 font-bold text-center border-b border-gray-400">รายการหักลบ ณ จ่าย (Deductions)</div>
                  <div className="p-1 px-3 flex justify-between">
                    <span>ภาษีหัก ณ ที่จ่าย 3%</span>
                    <strong>{activeSlip.tax.toLocaleString()}</strong>
                  </div>
                  <div className="p-1 px-3 flex justify-between">
                    <span>เงินสมทบกองประกันสังคม</span>
                    <strong>{activeSlip.sso.toLocaleString()}</strong>
                  </div>
                  {activeSlip.studentLoan > 0 ? (
                    <div className="p-1 px-3 flex justify-between">
                      <span>หักลบหนี้ กยศ. สังกัดรัฐ</span>
                      <strong>{activeSlip.studentLoan.toLocaleString()}</strong>
                    </div>
                  ) : (
                    <div className="p-1 px-3 flex justify-between text-gray-400">
                      <span>หักหนี้ กยศ.</span>
                      <span>—</span>
                    </div>
                  )}
                  <div className="p-1 px-3 flex justify-between bg-red-50/30">
                    <span>เงินหักอื่น / Other Deduction</span>
                    <strong>{activeSlip.otherDeduction.toLocaleString()}</strong>
                  </div>

                  <div className="p-1 px-3 flex justify-between text-gray-400">
                    <span>ค่าปรับขาดลาสาย</span>
                    <span>—</span>
                  </div>
                  <div className="p-1 px-3 flex justify-between text-gray-400">
                    <span>หักลบสะสมอื่นๆ</span>
                    <span>—</span>
                  </div>
                  <div className="p-1.5 bg-gray-150 text-right font-extrabold border-t border-gray-450 flex justify-between">
                    <span>รวมรายการหัก (Deduction)</span>
                    <span>{activeSlip.totalDeductions.toLocaleString()} ฿</span>
                  </div>
                </div>
              </div>

              {/* Net Earnings visual Slate */}
              <div className="bg-gray-100 p-4 border border-black rounded flex flex-col md:flex-row justify-between items-center text-xs font-mono font-bold">
                <div className="text-gray-700">ตัวอักษรรวมจ่ายสุทธิ: <span className="font-sans text-black font-extrabold">{thaiBahtText(activeSlip.netIncome)}</span></div>
                <div className="text-md font-extrabold text-black font-sans mt-1 md:mt-0">ยอดโอนสุทธิโอนเข้าบัญชีพนักงาน: <span className="underline underline-offset-4 text-base font-extrabold text-emerald-600">{activeSlip.netIncome.toLocaleString()} บาท</span></div>
              </div>

              {/* Signature Blocks matching standard official slip outputs */}
              <div className="grid grid-cols-2 gap-10 pt-10 text-center text-xs text-gray-600">
                <div className="border-t border-gray-300 pt-3">
                  <div className="h-6"></div>
                  <p className="font-bold text-black">(___________________________)</p>
                  <p className="mt-1">ผู้จัดทำ / ฝ่ายการเงิน และบริหารเงินเดือน</p>
                  <p className="text-[10px] text-gray-400">วันที่โอนจ่าย: {endDate}</p>
                </div>
                <div className="border-t border-gray-300 pt-3">
                  <div className="h-6"></div>
                  <p className="font-bold text-black">(___________________________)</p>
                  <p className="mt-1">ลายเซ็นผู้ลงทะเบียนพนักงานรับคืนสลิป</p>
                  <p className="text-[10px] text-gray-400">ข้าพเจ้าตรวจสอบความสมบูรณ์แล้วถูกต้อง</p>
                </div>
              </div>
            </div>

            {/* Print footer notice */}
            <div className="text-xs text-gray-500 font-mono text-center pt-3 border-t border-white/5">
              ออกแบบรองรับสัดส่วนเอกสาร A5 หรือ carbon slip ได้อย่างประณีต
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
