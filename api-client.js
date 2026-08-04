// api-client.js — API stubs for production backend

const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api' 
  : 'https://your-backend.onrender.com/api';

// Set to true when backend is ready
const USE_REAL_API = false;

const APIClient = {
  _headers() {
    const user = TelegramApp.getUser();
    return {
      'Content-Type': 'application/json',
      'X-Telegram-User-Id': user?.id || '123456789',
    };
  },

  _mockDelay(ms = 500) {
    return new Promise(r => setTimeout(r, ms));
  },

  // ---- Room ----
  async joinRoom(roomId, cartelaIndices) {
    if (!USE_REAL_API) {
      await this._mockDelay(600);
      return { success: true, roomId, cartelaIndices };
    }
    const res = await fetch(`${API_BASE}/room/join`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ roomId, cartelaIndices }),
    });
    return res.json();
  },

  // ---- Deposit ----
  async verifyDeposit(method, amount, sms) {
    if (!USE_REAL_API) {
      await this._mockDelay(1500);
      return { success: true, message: 'Deposit verified (mock)' };
    }
    const res = await fetch(`${API_BASE}/wallet/deposit/verify`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ method, amount, sms }),
    });
    return res.json();
  },

  // ---- Withdraw ----
  async requestWithdraw(method, phone, amount) {
    if (!USE_REAL_API) {
      await this._mockDelay(1000);
      return { success: true, message: 'Withdrawal request sent (mock)' };
    }
    const res = await fetch(`${API_BASE}/wallet/withdraw/request`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ method, phone, amount }),
    });
    return res.json();
  },

  // ---- Profile ----
  async updateProfile(phone) {
    if (!USE_REAL_API) {
      await this._mockDelay(300);
      return { success: true, phone };
    }
    const res = await fetch(`${API_BASE}/profile/update`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ phone }),
    });
    return res.json();
  },

  // ---- Balance ----
  async getBalance() {
    if (!USE_REAL_API) {
      await this._mockDelay(200);
      return { balance: 100 }; // default mock
    }
    const res = await fetch(`${API_BASE}/wallet/balance`, {
      headers: this._headers(),
    });
    return res.json();
  }
};

// Make globally available
window.APIClient = APIClient;