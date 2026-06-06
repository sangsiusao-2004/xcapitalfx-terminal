// ========== CLOCK ==========
export function updateClock() {
  const now = new Date();
  const ts = now.toLocaleTimeString('vi-VN', { hour12: false });
  const clockEl = document.getElementById('top-clock');
  const timeEl = document.getElementById('sb-time');
  if (clockEl) clockEl.textContent = ts;
  if (timeEl) timeEl.textContent = now.toLocaleDateString('vi-VN') + '  ' + ts;
}

// ========== SESSIONS ==========
export function renderSessions() {
  const utcH = new Date().getUTCHours();
  const sessions = [
    { name: 'TOKYO', start: 0, end: 9 },
    { name: 'LONDON', start: 8, end: 17 },
    { name: 'NEW YORK', start: 13, end: 22 },
  ];
  const cont = document.getElementById('sessions');
  if (!cont) return;

  cont.innerHTML = sessions.map(s => {
    const active = utcH >= s.start && utcH < s.end;
    const col = active ? 'var(--accent)' : 'var(--muted)';
    return `<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;padding:3px 0;">
      <span style="color:${col}">${s.name}</span>
      <span style="color:${col}">${active ? '● OPEN' : '○ CLOSE'}</span>
    </div>`;
  }).join('');
}
