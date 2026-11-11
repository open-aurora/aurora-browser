'use strict';

const params = new URLSearchParams(location.search);
const target = params.get('u') || '';
const code = params.get('code') || '';
const desc = params.get('desc') || '';

let host = '';
try { host = new URL(target).hostname; } catch {}
document.getElementById('host').textContent = host || target;
document.getElementById('code').textContent = code ? `Ошибка ${code}${desc ? ' · ' + desc : ''}` : '';

const explanations = {
  '-105': 'Не удалось найти адрес сервера. Возможно, домен указан неверно.',
  '-106': 'Нет подключения к интернету. Проверьте сеть и попробуйте снова.',
  '-118': 'Сервер не ответил вовремя. Попробуйте ещё раз через минуту.',
  '-102': 'Соединение было разорвано. Проверьте подключение.',
  '-109': 'Не удалось связаться с сервером. Возможно, сайт временно недоступен.',
  '-201': 'Не удалось проверить сертификат безопасности сайта.',
  '-501': 'Сайт отклонил защищённое соединение.',
};
if (explanations[code]) {
  document.getElementById('desc').textContent = explanations[code];
} else if (target) {
  document.getElementById('desc').textContent = 'Проверьте адрес, подключение к интернету и попробуйте ещё раз.';
}

document.getElementById('retryBtn').addEventListener('click', () => {
  if (window.aurora && target) window.aurora.retry(target);
});

document.getElementById('homeBtn').addEventListener('click', () => {
  if (window.aurora) window.aurora.open('aurora://start/start.html', false);
  else location.href = 'start.html';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && window.aurora && target) window.aurora.retry(target);
});
