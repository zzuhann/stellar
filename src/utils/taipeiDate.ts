const taipeiDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' });

// Cloud Run runs in UTC; toISOString().slice(0, 10) is wrong between 00:00–08:00 Taipei
export const getTaipeiDateString = (now: Date): string => taipeiDateFormat.format(now);
