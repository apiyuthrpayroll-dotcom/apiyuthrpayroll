import React, { useState } from 'react';
import { SystemSettings } from '../types';
import { Sliders, Save, CheckCircle, RotateCcw, AlertTriangle, Coins, ShieldCheck, HelpCircle } from 'lucide-react';

interface SettingsSectionProps {
  settings: SystemSettings;
  onUpdateSettings: (updated: SystemSettings) => void;
  isDark: boolean;
}

export default function SettingsSection({ settings, onUpdateSettings, isDark }: SettingsSectionProps) {
  const [ot15, setOt15] = useState(settings.ot15Rate);
  const [ot20, setOt20] = useState(settings.ot20Rate);
  const [ot30, setOt30] = useState(settings.ot30Rate);
  const [dailyWage, setDailyWage] = useState(settings.defaultDailyWage);
  const [workHours, setWorkHours] = useState(settings.defaultWorkHours);
  
  const [showStatus, setShowStatus] = useState<boolean>(false);

  const resetToDefault = () => {
    setOt15(1.5);
    setOt20(2.0);
    setOt30(3.0);
    setDailyWage(350);
    setWorkHours(8);
    
    onUpdateSettings({
      ot15Rate: 1.5,
      ot20Rate: 2.0,
      ot30Rate: 3.0,
      defaultDailyWage: 350,
      defaultWorkHours: 8
    });
    
    setShowStatus(true);
    setTimeout(() => setShowStatus(false), 2500);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      ot15Rate: Number(ot15),
      ot20Rate: Number(ot20),
      ot30Rate: Number(ot30),
      defaultDailyWage: Number(dailyWage),
      defaultWorkHours: Number(workHours)
    });
    setShowStatus(true);
    setTimeout(() => setShowStatus(false), 2500);
  };

  const bgCard = isDark ? 'bg-[#141414] border-white/10' : 'bg-white border-slate-200 shadow-sm';
  const labelText = isDark ? 'text-gray-450 font-mono text-[10px]' : 'text-slate-600 font-bold text-[10px]';
  const inputBg = isDark ? 'bg-[#0D0D0D] border-white/10 text-white focus:border-[#D4AF37]' : 'bg-white border-slate-300 text-slate-800 focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37]';
  const textTitle = isDark ? 'text-white' : 'text-slate-850';
  const textSub = isDark ? 'text-gray-400' : 'text-slate-500';

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      <div className={`p-5 rounded-sm border ${bgCard}`}>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-base font-serif uppercase tracking-wider text-[#D4AF37] flex items-center gap-2">
              <Sliders className="w-5 h-5 text-[#D4AF37]" />
              หน้าปรับแต่งตัวเลือกคำนวณเงินค่าแรงและเรทโอที (Calculate Preferences & Policy Configurator)
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              แก้ไขตัวคูณและค่าแรงขั้นต่ำเริ่มต้นของระบบ (Multipliers Setup) อัปเดตแบบเรียลไทม์ไม่ต้องเขียนโค้ดซ้ำซาก
            </p>
          </div>
          
          <button
            onClick={resetToDefault}
            className={`flex items-center gap-1.5 bg-transparent border border-amber-500/25 hover:bg-amber-500/5 text-amber-500 font-bold text-xs py-2 px-3.5 rounded-sm transition-all cursor-pointer`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            คืนค่าเริ่มต้นโรงงาน (Reset)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Policy variables forms */}
        <form onSubmit={handleSave} className={`md:col-span-2 p-6 rounded-sm border ${bgCard} space-y-6`}>
          <div className="border-b border-dashed border-white/10 pb-4">
            <h3 className={`text-xs font-bold uppercase tracking-wider ${textTitle} flex items-center gap-2`}>
              <Coins className="w-4 h-4 text-[#D4AF37]" />
              ค่าสัมประสิทธิ์ตัวคูณเงินล่วงเวลา (Overtime Multiplying Coefficients)
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              ตั้งค่าเรทคูณเงินต่อชั่วโมงของแต่ละช่องตามกฎหมายแรงงานหรือสัญญารับเหมา
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className={`block uppercase tracking-wider ${labelText}`}>เรทโอที 1.5 เท่า (ปกติวันทำงาน)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                  value={ot15}
                  onChange={(e) => setOt15(Number(e.target.value))}
                  className={`w-full text-xs rounded-sm py-2 px-3 font-semibold ${inputBg}`}
                  required
                />
                <span className="absolute right-3 top-2.5 text-[9px] font-mono text-gray-500">x</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={`block uppercase tracking-wider ${labelText}`}>เรทโอที 2.0 เท่า (วันหยุดทำงานปกติ)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                  value={ot20}
                  onChange={(e) => setOt20(Number(e.target.value))}
                  className={`w-full text-xs rounded-sm py-2 px-3 font-semibold ${inputBg}`}
                  required
                />
                <span className="absolute right-3 top-2.5 text-[9px] font-mono text-gray-500">x</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={`block uppercase tracking-wider ${labelText}`}>เรทโอที 3.0 เท่า (ล่วงเวลาวันหยุด)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                  value={ot30}
                  onChange={(e) => setOt30(Number(e.target.value))}
                  className={`w-full text-xs rounded-sm py-2 px-3 font-semibold ${inputBg}`}
                  required
                />
                <span className="absolute right-3 top-2.5 text-[9px] font-mono text-gray-500">x</span>
              </div>
            </div>
          </div>

          <div className="border-b border-dashed border-white/10 pb-4 pt-2">
            <h3 className={`text-xs font-bold uppercase tracking-wider ${textTitle} flex items-center gap-2`}>
              <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
              ฐานเกณฑ์พนักงานรายวันเริ่มต้น (Daily Workers Default Wage Policies)
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              ตัวสำรองเมื่อไม่พบการระบุค่าจ้างเฉพาะของช่างในประวัติ เพื่อใช้เป็นพารามิเตอร์คำนวณเบ็ดเสร็จ
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={`block uppercase tracking-wider ${labelText}`}>ค่าจ้างรายวันพื้นฐานเริ่มต้น (Default Daily Wage)</label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  min="100"
                  max="5000"
                  value={dailyWage}
                  onChange={(e) => setDailyWage(Number(e.target.value))}
                  className={`w-full text-xs rounded-sm py-2 px-3 pl-8 font-semibold ${inputBg}`}
                  required
                />
                <span className="absolute left-3 top-2.5 text-[9px] font-bold text-[#D4AF37]">฿</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={`block uppercase tracking-wider ${labelText}`}>จำนวนชั่วโมงทำงานต่อวันปกติ (Hours / Day)</label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  min="4"
                  max="12"
                  value={workHours}
                  onChange={(e) => setWorkHours(Number(e.target.value))}
                  className={`w-full text-xs rounded-sm py-2 px-3 font-semibold ${inputBg}`}
                  required
                />
                <span className="absolute right-3 top-2.5 text-[9px] font-mono text-gray-500">ชม.</span>
              </div>
            </div>
          </div>

          <div className="pt-4 flex items-center justify-between">
            {showStatus ? (
              <div className="flex items-center gap-1.5 text-emerald-500 font-bold text-xs animate-pulse bg-emerald-500/10 py-1.5 px-3 rounded-full">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                ✓ บันทึกการอัปเดตนโยบายคำนวณลงเบราว์เซอร์สัมฤทธิ์ผลแล้ว!
              </div>
            ) : <div />}

            <button
              id="save-settings-btn"
              type="submit"
              className="flex items-center gap-2 bg-[#D4AF37] hover:bg-amber-400 text-black font-extrabold text-xs py-2.5 px-6 rounded-sm uppercase tracking-wider transition-all shadow-md transform active:scale-95 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              บันทึกการเปลี่ยนแปลง (Save Configurations)
            </button>
          </div>
        </form>

        {/* Sidebar Info Card */}
        <div className="space-y-4">
          <div className={`p-5 rounded-sm border ${bgCard} space-y-4`}>
            <div className="flex items-center gap-2 text-[#D4AF37] text-xs font-bold uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4 text-[#D4AF37]" />
              ข้อควรระวังทางกฎหมาย
            </div>
            <div className="text-[11px] text-gray-400 space-y-2.5 leading-relaxed">
              <p>
                ตาม <strong className="text-white">พระราชบัญญัติคุ้มครองแรงงานของไทย</strong> การจ่ายเงินค่าทำงานล่วงเวลา (Overtime Pay) มีเกณฑ์ควบคุมขั้นต่ำ:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-gray-500">
                <li>ล่วงเวลาในวันทำงานปกติ: <strong className="text-gray-300">ไม่น้อยกว่า 1.5 เท่า</strong> ของอัตราปกติ</li>
                <li>ทำงานในวันหยุด (เวลาทำงานปกติ): <strong className="text-gray-300">ไม่น้อยกว่า 1 เท่า (สำหรับรายเดือน) หรือ 2 เท่า (สำหรับรายวัน)</strong></li>
                <li>ล่วงเวลาทำงานในวันหยุด: <strong className="text-gray-300">ไม่น้อยกว่า 3 เท่า</strong></li>
              </ul>
              <p className="border-t border-white/5 pt-2.5">
                การตั้งค่าตัวคูณต่ำกว่ามาตรฐานกฎหมายอาจส่งผลให้เกิดความขัดแย้งด้านคดีแรงงานได้ โปรดตรวจสอบกับฝ่ายกฎหมายก่อนปรับลดค่าเรท
              </p>
            </div>
          </div>

          <div className={`p-4 rounded-sm border ${bgCard} flex items-start gap-3`}>
            <HelpCircle className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h4 className={`text-xs font-bold ${textTitle}`}>สูตรคำนวณเรทต่อชั่วโมง</h4>
              <p className="text-[10.5px] text-gray-400 leading-normal mt-1">
                - **พนักงานประจำ**: <br/> HourlyRate = (เงินเดือนประจำ / 30 / 8)<br/>
                - **พนักงานชั่วคราว/รายวัน**: <br/> HourlyRate = (ค่าเรทไซส์งานหน้างาน / 8)<br/>
                *(และจะคูณต่อด้วยเกณฑ์ OT ที่คุณตั้งไว้)*
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
