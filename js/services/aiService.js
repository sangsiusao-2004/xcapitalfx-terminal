import { postJson } from '../request/apiClient.js';

export function askTradingAssistant({ question, symbol, timeframe }) {
  return postJson('/api/ai/chat', {
    question,
    symbol,
    timeframe,
  });
}
