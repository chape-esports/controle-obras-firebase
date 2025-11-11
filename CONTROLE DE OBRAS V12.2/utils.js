import { projectColors } from './store.js';

const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast p-4 rounded-lg shadow-lg text-white ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 4500);
};

const getColorForId = (id) => {
    if (!id) return projectColors[0];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % projectColors.length);
    return projectColors[index];
};

const addDays = (dateStr, days) => {
    const date = new Date(dateStr + 'T00:00:00'); // Ensure we work with local date part only
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
};

const diffInDays = (d1, d2) => {
    // Treat dates as local dates to avoid timezone issues affecting day count
    const date1 = new Date(d1 + 'T00:00:00');
    const date2 = new Date(d2 + 'T00:00:00');
    // Calculate difference in milliseconds and convert to days
    return Math.round((date2 - date1) / (1000 * 60 * 60 * 24));
};

const getWeekNumber = (d) => {
    const date = new Date(d.valueOf());
    date.setHours(0, 0, 0, 0);
    // Thursday in current week decides the year.
    date.setDate(date.getDate() + 4 - (date.getDay() || 7));
    // Get first day of year
    const yearStart = new Date(date.getFullYear(), 0, 1);
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

export { showToast, getColorForId, addDays, diffInDays, getWeekNumber };
