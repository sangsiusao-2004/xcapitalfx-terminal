// ========== AUTH ==========

export function checkAuth() {
  if (!sessionStorage.getItem('tx_auth')) {
    window.location.href = '/dang-nhap';
  }
}

export function logout() {
  sessionStorage.removeItem('tx_auth');
  sessionStorage.removeItem('tx_user');
  window.location.href = '/dang-nhap';
}
