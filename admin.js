// ============================================================
// ZA BINGO — ADMIN PAGE
// ============================================================

import { db } from './firebase-config.js';

import {
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


// ============================================================
// ADMIN LOGIN
// ============================================================

const loginScreen =
  document.getElementById('loginScreen');

const adminDashboard =
  document.getElementById('adminDashboard');


document.getElementById('loginBtn').addEventListener('click', async () => {

  const password =
    document.getElementById('adminPassword').value;

  const message =
    document.getElementById('loginMessage');


  if (!password) {

    message.textContent =
      'Enter admin password.';

    return;
  }


  try {

    const response = await fetch('/api/admin/login', {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        password
      })

    });


    const result =
      await response.json();


    if (!response.ok || !result.success) {

      message.textContent =
        '❌ Invalid admin password.';

      return;
    }


    loginScreen.style.display =
      'none';

    adminDashboard.style.display =
      'block';


  } catch (error) {

    console.error(
      'Admin login error:',
      error
    );

    message.textContent =
      '❌ Could not connect to the server.';

  }

});


// ============================================================
// PLAYERS
// ============================================================

const playersRef =
  ref(db, 'players');

let allPlayers = {};


onValue(playersRef, (snapshot) => {

  allPlayers =
    snapshot.val() || {};


  renderPlayers(allPlayers);


  let count = 0;
  let totalBalance = 0;


  Object.values(allPlayers).forEach(player => {

    if (!player) return;

    count++;

    totalBalance +=
      Number(player.balance || 0);

  });


  document.getElementById('playersCount').textContent =
    count;


  document.getElementById('totalBalance').textContent =
    `${totalBalance.toFixed(2)} Br`;

});


// ============================================================
// RENDER PLAYERS
// ============================================================

function renderPlayers(players) {

  const list =
    document.getElementById('playersList');


  list.innerHTML = '';


  Object.entries(players)
  .sort(([, a], [, b]) => {
    return Number(b?.balance || 0) - Number(a?.balance || 0);
  })
  .forEach(([id, player]) => {

    if (!player) return;

    const div =
      document.createElement('div');

    div.style.padding =
      '12px';

    div.style.borderBottom =
      '1px solid #263044';

    div.innerHTML = `

      <strong>
        ${player.first_name || 'Player'}
      </strong>

      <br>

      ID:
      ${id}

      <br>

      Username:
      @${player.username || 'N/A'}

      <br>

      Phone:
      ${player.phone || 'N/A'}

      <br>

      Balance:
      ${Number(player.balance || 0).toFixed(2)} Br

    `;

    list.appendChild(div);

  });
}

// ============================================================
// PLAYER SEARCH
// ============================================================

document
  .getElementById('playerSearch')
  .addEventListener('input', (event) => {


    const search =
      event.target.value
        .toLowerCase()
        .trim();


    if (!search) {

      renderPlayers(allPlayers);

      return;
    }


    const filtered = {};


    Object.entries(allPlayers).forEach(([id, player]) => {

      if (!player) return;


      const name =
        String(
          player.first_name || ''
        ).toLowerCase();


      const username =
        String(
          player.username || ''
        ).toLowerCase();


      const phone =
        String(
          player.phone || ''
        );


      // --------------------------------------------------------
      // NORMALIZE PHONE
      // --------------------------------------------------------

      const normalizePhone = (value) => {

        value =
          value.replace(/\D/g, '');


        if (value.startsWith('0')) {

          return (
            '251' +
            value.substring(1)
          );

        }


        if (value.startsWith('251')) {

          return value;

        }


        return value;

      };


      const searchPhone =
        normalizePhone(search);


      const playerPhone =
        normalizePhone(phone);


      // --------------------------------------------------------
      // SEARCH
      // --------------------------------------------------------

      if (

        id
          .toLowerCase()
          .includes(search)

        ||

        name.includes(search)

        ||

        username.includes(search)

        ||

        playerPhone.includes(searchPhone)

      ) {

        filtered[id] =
          player;

      }

    });


    renderPlayers(filtered);

  });


// ============================================================
// LOGOUT
// ============================================================

document
  .getElementById('logoutBtn')
  .addEventListener('click', () => {


    adminDashboard.style.display =
      'none';


    loginScreen.style.display =
      'flex';


    document.getElementById(
      'adminPassword'
    ).value = '';


    document.getElementById(
      'loginMessage'
    ).textContent = '';

  });


// ============================================================
// ADMIN — ADD BALANCE
// ============================================================

document
  .getElementById('addBalanceBtn')
  .addEventListener('click', async () => {


    const playerId =
      document
        .getElementById('balancePlayerId')
        .value
        .trim();


    const amount =
      Number(
        document
          .getElementById('balanceAmount')
          .value
      );


    const message =
      document.getElementById(
        'balanceMessage'
      );


    if (!playerId) {

      message.textContent =
        '❌ Enter Player ID.';

      return;
    }


    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {

      message.textContent =
        '❌ Enter a valid amount.';

      return;
    }


    const password =
      document
        .getElementById('adminPassword')
        .value;


    try {

      const response =
        await fetch(
          '/api/admin/add-balance',
          {

            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({

              password,

              playerId,

              amount

            })

          }
        );


      const result =
        await response.json();


      if (
        !response.ok ||
        !result.success
      ) {

        message.textContent =
          `❌ ${
            result.message ||
            'Failed to add balance.'
          }`;

        return;
      }


      message.textContent =
        `✅ Added ${
          amount.toFixed(2)
        } Br. New balance: ${
          result.newBalance.toFixed(2)
        } Br`;


      document.getElementById(
        'balanceAmount'
      ).value = '';


    } catch (error) {

      console.error(
        'Add balance error:',
        error
      );


      message.textContent =
        '❌ Could not connect to server.';

    }

  });


// ============================================================
// ADMIN — TRANSACTIONS DATABASE
// ============================================================

const transactionsRef =
  ref(db, 'transactions');


// ============================================================
// STATUS HELPER
// ============================================================

function getStatusHTML(status) {

  const value =
    String(status || 'N/A').toLowerCase();

  if (value === 'pending') {

    return `
      <span class="status-pending">
        Pending
      </span>
    `;

  }

  if (
    value === 'approved' ||
    value === 'approve'
  ) {

    return `
      <span class="status-approved">
        Approved
      </span>
    `;

  }

  return status || 'N/A';

}


// ============================================================
// ADMIN — DEPOSITS
// ============================================================

onValue(
  transactionsRef,
  (snapshot) => {


    const transactions =
      snapshot.val() || {};


    const depositsList =
      document.getElementById(
        'depositsList'
      );


    let count = 0;


    depositsList.innerHTML =
      '';


    Object.entries(transactions)
      .forEach(([id, transaction]) => {


        if (!transaction) return;


        if (
  transaction.type !==
  'deposit'
) return;

if (
  String(transaction.status || '').toLowerCase() ===
  'pending'
) {
  count++;
}


        const div =
          document.createElement(
            'div'
          );


        div.style.padding =
          '12px';


        div.style.borderBottom =
          '1px solid #263044';


        div.innerHTML = `

          <strong>
            Deposit:
            ${Number(
              transaction.amount || 0
            ).toFixed(2)} Br
          </strong>

          <br>

          Player:
          <span class="copyable-player">
            ${
              transaction.playerId ||
              transaction.telegramId ||
              'N/A'
            }
          </span>

          <br>

          Method:
          ${
            transaction.paymentMethod ||
            'N/A'
          }

          <br>

          Status:
${
  getStatusHTML(
    transaction.status
  )
}

${
  String(transaction.status || '').toLowerCase() === 'pending'
    ? `
      <br><br>
      <button
        class="approve-transaction-btn"
        data-transaction-id="${id}"
        data-transaction-type="deposit">
        ✅ Approve Deposit
      </button>
    `
    : ''
}

<br>

Transaction ID:
          <span class="copyable-player">
            ${
              transaction.transactionId ||
              'N/A'
            }
          </span>

          <br>

          Date:
          ${
            transaction.createdAt ||
            'N/A'
          }

        `;


        depositsList.appendChild(
          div
        );

      });


    document.getElementById(
      'depositCount'
    ).textContent = count;

  }
);


// ============================================================
// ADMIN — WITHDRAWALS
// ============================================================

onValue(
  transactionsRef,
  (snapshot) => {


    const transactions =
      snapshot.val() || {};


    const withdrawalsList =
      document.getElementById(
        'withdrawalsList'
      );


    let count = 0;


    withdrawalsList.innerHTML =
      '';


    Object.entries(transactions)
      .forEach(([id, transaction]) => {


        if (!transaction) return;


        if (
  transaction.type !==
  'withdrawal'
) return;

if (
  String(transaction.status || '').toLowerCase() ===
  'pending'
) {
  count++;
}


        const div =
          document.createElement(
            'div'
          );


        div.style.padding =
          '12px';


        div.style.borderBottom =
          '1px solid #263044';


        div.innerHTML = `

          <strong>
            Withdrawal:
            ${Number(
              transaction.amount || 0
            ).toFixed(2)} Br
          </strong>

          <br>

          Player:
          <span class="copyable-player">
            ${
              transaction.playerId ||
              transaction.telegramId ||
              'N/A'
            }
          </span>

          <br>

          Method:
          ${
            transaction.paymentMethod ||
            'N/A'
          }

          <br>

          Status:
${
  getStatusHTML(
    transaction.status
  )
}

${
  String(transaction.status || '').toLowerCase() === 'pending'
    ? `
      <br><br>
      <button
        class="approve-transaction-btn"
        data-transaction-id="${id}"
        data-transaction-type="withdrawal">
        ✅ Approve Withdrawal
      </button>
    `
    : ''
}

<br>

Transaction ID:
          <span class="copyable-player">
            ${
              transaction.transactionId ||
              'Pending'
            }
          </span>

          <br>

          Date:
          ${
            transaction.createdAt ||
            'N/A'
          }

        `;


        withdrawalsList.appendChild(
          div
        );

      });


    document.getElementById(
      'withdrawalCount'
    ).textContent = count;

  }
);


// ============================================================
// ADMIN — ALL TRANSACTIONS
// ============================================================

onValue(
  transactionsRef,
  (snapshot) => {


    const transactions =
      snapshot.val() || {};


    const transactionsList =
      document.getElementById(
        'transactionsList'
      );


    transactionsList.innerHTML =
      '';


    Object.entries(transactions)
      .forEach(([id, transaction]) => {


        if (!transaction) return;


        const div =
          document.createElement(
            'div'
          );


        div.style.padding =
          '12px';


        div.style.borderBottom =
          '1px solid #263044';


        div.innerHTML = `

          <strong>
            ${
              transaction.type ||
              'Transaction'
            }
          </strong>

          <br>

          Player:
          ${
            transaction.playerId ||
            transaction.telegramId ||
            'N/A'
          }

          <br>

          Amount:
          ${Number(
            transaction.amount || 0
          ).toFixed(2)} Br

          <br>

          Status:
          ${
            transaction.status ||
            'N/A'
          }

          <br>

          Transaction ID:
          ${
            transaction.transactionId ||
            'N/A'
          }

          <br>

          Date:
          ${
            transaction.createdAt ||
            'N/A'
          }

        `;


        transactionsList.appendChild(
          div
        );

      });

  }
);


// ============================================================
// ADMIN — MAIN BOTTOM NAVIGATION
// ============================================================

const navItems =
  document.querySelectorAll(
    '.nav-item'
  );


const tabContents =
  document.querySelectorAll(
    '.tab-content'
  );


navItems.forEach((navItem) => {

  navItem.addEventListener(
    'click',
    () => {


      const targetTab =
        navItem.dataset.tab;


      navItems.forEach(item => {

        item.classList.remove(
          'active'
        );

      });


      tabContents.forEach(tab => {

        tab.classList.remove(
          'active'
        );

      });


      navItem.classList.add(
        'active'
      );


      const selectedTab =
        document.getElementById(
          targetTab
        );


      if (selectedTab) {

        selectedTab.classList.add(
          'active'
        );

      }

    }
  );

});


// ============================================================
// ADMIN — PLAYERS SUB NAVIGATION
// ============================================================

const playerSubnavButtons =
  document.querySelectorAll(
    '.player-subnav-btn'
  );


const playerTabContents =
  document.querySelectorAll(
    '.player-tab-content'
  );


playerSubnavButtons.forEach((button) => {

  button.addEventListener(
    'click',
    () => {


      const targetPlayerTab =
        button.dataset.playerTab;


      playerSubnavButtons.forEach(item => {

        item.classList.remove(
          'active'
        );

      });


      playerTabContents.forEach(tab => {

        tab.classList.remove(
          'active'
        );

      });


      button.classList.add(
        'active'
      );


      const selectedPlayerTab =
        document.getElementById(
          targetPlayerTab
        );


      if (selectedPlayerTab) {

        selectedPlayerTab.classList.add(
          'active'
        );

      }

    }
  );

});


// ============================================================
// ADMIN — STATUS SUB NAVIGATION
// ============================================================

const statusNavButtons =
  document.querySelectorAll(
    '.status-nav-btn'
  );


const statusContents =
  document.querySelectorAll(
    '.status-content'
  );


statusNavButtons.forEach((button) => {

  button.addEventListener(
    'click',
    () => {


      const targetStatus =
        button.dataset.statusTab;


      statusNavButtons.forEach(item => {

        item.classList.remove(
          'active'
        );

      });


      statusContents.forEach(tab => {

        tab.classList.remove(
          'active'
        );

      });


      button.classList.add(
        'active'
      );


      const selectedStatus =
        document.getElementById(
          targetStatus
        );


      if (selectedStatus) {

        selectedStatus.classList.add(
          'active'
        );

      }

    }
  );

});
document
  .getElementById('saveSimSettingsBtn')
  .addEventListener('click', async () => {

    const settings = {
      '5br': Number(document.getElementById('sim5br').value),
      '10br': Number(document.getElementById('sim10br').value),
      '20br': Number(document.getElementById('sim20br').value)
    };

    try {
      const response = await fetch('/api/admin/sim-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ settings })
      });

      const data = await response.json();

      document.getElementById('simSettingsMessage').textContent =
        data.success
          ? '✅ Sim settings saved'
          : '❌ Failed to save settings';

    } catch (error) {
      console.error(error);

      document.getElementById('simSettingsMessage').textContent =
        '❌ Failed to save settings';
    }
  });
  async function loadSimSettings() {
  try {
    const response = await fetch('/api/admin/sim-settings');
    const data = await response.json();

    if (!data.success) return;

    document.getElementById('sim5br').value = data.settings['5br'];
    document.getElementById('sim10br').value = data.settings['10br'];
    document.getElementById('sim20br').value = data.settings['20br'];

  } catch (error) {
    console.error('❌ Failed to load sim settings:', error);
  }
}

loadSimSettings();
// ============================================================
// ADMIN — APPROVE TRANSACTION BUTTON
// ============================================================

document.addEventListener('click', async (event) => {

  const button =
    event.target.closest('.approve-transaction-btn');

  if (!button) return;

  const transactionId =
    button.dataset.transactionId;

  const password =
    document.getElementById('adminPassword').value;

  if (!transactionId) return;

  button.disabled = true;
  button.textContent = 'Approving...';

  try {

    const response = await fetch(
      '/api/admin/approve-transaction',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          password,
          transactionId
        })
      }
    );

    const result =
      await response.json();

    if (!response.ok || !result.success) {

      button.disabled = false;

      button.textContent =
        button.dataset.transactionType === 'withdrawal'
          ? '✅ Approve Withdrawal'
          : '✅ Approve Deposit';

      alert(
        result.message ||
        'Failed to approve transaction.'
      );

      return;
    }

    button.textContent = '✅ Approved';

  } catch (error) {

    console.error(error);

    button.disabled = false;

    button.textContent =
      button.dataset.transactionType === 'withdrawal'
        ? '✅ Approve Withdrawal'
        : '✅ Approve Deposit';

    alert('Could not connect to server.');

  }

});