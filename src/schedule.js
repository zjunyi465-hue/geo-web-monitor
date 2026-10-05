export function nextRunAt(type, timeHHMM, weekdays, from = new Date()) {
  if (type === 'manual') return null;
  if (!['daily', 'weekly'].includes(type)) throw new Error('无效任务周期');
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeHHMM);
  if (!match) throw new Error('时间须为 HH:MM');
  if (type === 'weekly' && (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) {
    throw new Error('每周任务至少选择一个有效运行日');
  }
  for (let days = 0; days <= 7; days++) {
    const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, Number(match[1]), Number(match[2]));
    if (candidate <= from) continue;
    if (type === 'daily' || weekdays.includes(candidate.getDay())) return candidate.toISOString();
  }
  throw new Error('无法计算下次运行时间');
}
