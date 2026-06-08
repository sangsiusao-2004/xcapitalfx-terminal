// ========== AI CHAT ==========
import { askTradingAssistant } from './services/aiService.js';

export async function askAI(currentSym, currentTf) {
  const input = document.getElementById('ai-q');
  const q = input?.value.trim();
  if (!q) return;
  input.value = '';

  const body = document.getElementById('signal-body');
  const chatEl = document.createElement('div');
  chatEl.className = 'ai-chat-bubble';
  chatEl.innerHTML = `
    <div class="ai-q-text">❯ ${q}</div>
    <div class="ai-a-text loading">Đang phân tích...</div>`;
  body.insertBefore(chatEl, body.firstChild);

  try {
    const data = await askTradingAssistant({
      question: q,
      symbol: currentSym,
      timeframe: currentTf,
      userEmail: JSON.parse(sessionStorage.getItem('tx_user') || '{}').email,
    });

    chatEl.querySelector('.ai-a-text').classList.remove('loading');
    chatEl.querySelector('.ai-a-text').textContent = data.answer || 'Không có phản hồi.';
  } catch (e) {
    chatEl.querySelector('.ai-a-text').classList.remove('loading');
    chatEl.querySelector('.ai-a-text').innerHTML =
      `<span style="color:var(--red)">✕ ${e.message || 'Lỗi kết nối backend'}</span>`;
  }
}
